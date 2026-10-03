import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_VEHICLE_PHOTOS,
  PHOTO_VARIANTS,
  type PhotoVariant,
  type VehiclePhoto as VehiclePhotoView,
} from '@vrp/contracts';
import {
  uuidv7,
  vehiclePhotos,
  type Database,
  type DatabaseExecutor,
  type ProviderProfile,
  type VehiclePhoto,
} from '@vrp/database';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.types';
import { processVehiclePhoto } from '../storage/image-processor';
import { StorageService } from '../storage/storage.service';
import { editability } from './vehicle.state';
import { VehiclesService } from './vehicles.service';

export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

const VARIANT_NAMES = Object.keys(PHOTO_VARIANTS) as PhotoVariant[];

/**
 * Listing photos (TECH_DECISIONS D43). Uploads go through the API: the bytes
 * are validated and re-encoded, originals land in the private bucket under a
 * server-generated key, WebP variants in the public bucket. Photos can be
 * changed while the listing is editable by the provider (`draft`,
 * `changes_requested`); after approval they are part of what was reviewed.
 */
@Injectable()
export class VehiclePhotosService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly vehicles: VehiclesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VehiclePhotosService.name);
  }

  async listActive(
    vehicleId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<VehiclePhoto[]> {
    return executor
      .select()
      .from(vehiclePhotos)
      .where(and(eq(vehiclePhotos.vehicleId, vehicleId), isNull(vehiclePhotos.deletedAt)))
      .orderBy(asc(vehiclePhotos.sortOrder), asc(vehiclePhotos.createdAt));
  }

  /** Active photos for several vehicles at once (list pages), ordered per vehicle. */
  async listActiveFor(vehicleIds: readonly string[]): Promise<Map<string, VehiclePhoto[]>> {
    const result = new Map<string, VehiclePhoto[]>();
    if (vehicleIds.length === 0) return result;
    const rows = await this.db
      .select()
      .from(vehiclePhotos)
      .where(
        and(inArray(vehiclePhotos.vehicleId, [...vehicleIds]), isNull(vehiclePhotos.deletedAt)),
      )
      .orderBy(
        asc(vehiclePhotos.vehicleId),
        asc(vehiclePhotos.sortOrder),
        asc(vehiclePhotos.createdAt),
      );
    for (const row of rows) {
      const list = result.get(row.vehicleId) ?? [];
      list.push(row);
      result.set(row.vehicleId, list);
    }
    return result;
  }

  async listViews(vehicleId: string): Promise<VehiclePhotoView[]> {
    return (await this.listActive(vehicleId)).map((row) => this.toView(row));
  }

  toView(row: VehiclePhoto): VehiclePhotoView {
    return {
      id: row.id,
      sortOrder: row.sortOrder,
      isPrimary: row.sortOrder === 0,
      width: row.width,
      height: row.height,
      variants: this.variantUrls(row.publicPrefix),
      createdAt: row.createdAt.toISOString(),
    };
  }

  variantUrls(publicPrefix: string): Record<PhotoVariant, string> {
    return Object.fromEntries(
      VARIANT_NAMES.map((name) => [name, this.storage.publicUrl(`${publicPrefix}/${name}.webp`)]),
    ) as Record<PhotoVariant, string>;
  }

  async upload(
    provider: ProviderProfile,
    vehicleId: string,
    file: UploadedImage,
    meta: RequestMeta,
  ): Promise<VehiclePhoto> {
    const vehicle = await this.assertEditable(provider.id, vehicleId);
    const existing = await this.listActive(vehicleId);
    if (existing.length >= MAX_VEHICLE_PHOTOS) {
      throw new ApiException(
        'CONFLICT',
        `A listing can have at most ${MAX_VEHICLE_PHOTOS} photos; remove one first`,
        409,
        [{ field: 'file', issue: 'photo limit reached' }],
      );
    }

    const processed = await processVehiclePhoto(file.buffer);
    const photoId = uuidv7();
    const prefix = `vehicles/${vehicle.id}/${photoId}`;
    const storageKey = `${prefix}/original.${processed.format === 'jpeg' ? 'jpg' : processed.format}`;

    await this.storage.put({
      bucket: 'private',
      key: storageKey,
      body: file.buffer,
      contentType: processed.mimeType,
    });
    for (const name of VARIANT_NAMES) {
      await this.storage.put({
        bucket: 'public',
        key: `${prefix}/${name}.webp`,
        body: processed.variants[name],
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }

    const nextOrder = existing.reduce((max, p) => Math.max(max, p.sortOrder + 1), 0);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(vehiclePhotos)
        .values({
          id: photoId,
          vehicleId: vehicle.id,
          storageKey,
          publicPrefix: prefix,
          mimeType: processed.mimeType,
          sizeBytes: file.size,
          width: processed.width,
          height: processed.height,
          sortOrder: nextOrder,
        })
        .returning();
      if (!row) throw new Error('Failed to store photo');
      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle_photo.added',
          targetType: 'vehicle',
          targetId: vehicle.id,
          ip: meta.ip ?? null,
          metadata: {
            photoId,
            format: processed.format,
            bytes: file.size,
            width: processed.width,
            height: processed.height,
          },
        },
        tx,
      );
      return row;
    });
  }

  async remove(
    provider: ProviderProfile,
    vehicleId: string,
    photoId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const vehicle = await this.assertEditable(provider.id, vehicleId);
    const removed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(vehiclePhotos)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(vehiclePhotos.id, photoId),
            eq(vehiclePhotos.vehicleId, vehicle.id),
            isNull(vehiclePhotos.deletedAt),
          ),
        )
        .returning();
      if (!row) throw new ApiException('NOT_FOUND', 'Photo not found', 404);
      await this.renumber(tx, vehicle.id);
      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle_photo.removed',
          targetType: 'vehicle',
          targetId: vehicle.id,
          ip: meta.ip ?? null,
          metadata: { photoId: row.id },
        },
        tx,
      );
      return row;
    });

    // Best effort: a failed delete leaves an orphan object, never a dangling row.
    try {
      await this.storage.delete('private', [removed.storageKey]);
      await this.storage.delete(
        'public',
        VARIANT_NAMES.map((name) => `${removed.publicPrefix}/${name}.webp`),
      );
    } catch (error) {
      this.logger.warn(
        { photoId: removed.id, err: error instanceof Error ? error.message : String(error) },
        'Photo objects could not be deleted from storage',
      );
    }
  }

  async reorder(
    provider: ProviderProfile,
    vehicleId: string,
    photoIds: readonly string[],
    meta: RequestMeta,
  ): Promise<VehiclePhoto[]> {
    const vehicle = await this.assertEditable(provider.id, vehicleId);
    return this.db.transaction(async (tx) => {
      const active = await this.listActive(vehicle.id, tx);
      const activeIds = new Set(active.map((p) => p.id));
      const given = new Set(photoIds);
      if (activeIds.size !== given.size || [...activeIds].some((id) => !given.has(id))) {
        throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
          { field: 'photoIds', issue: 'must list every current photo of the vehicle exactly once' },
        ]);
      }
      for (const [index, id] of photoIds.entries()) {
        await tx.update(vehiclePhotos).set({ sortOrder: index }).where(eq(vehiclePhotos.id, id));
      }
      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle_photo.reordered',
          targetType: 'vehicle',
          targetId: vehicle.id,
          ip: meta.ip ?? null,
          metadata: { primaryPhotoId: photoIds[0] },
        },
        tx,
      );
      return this.listActive(vehicle.id, tx);
    });
  }

  /** Ownership check for read-only photo listings (404 for other providers' vehicles). */
  async assertOwned(providerId: string, vehicleId: string): Promise<void> {
    await this.vehicles.getOwned(providerId, vehicleId);
  }

  // ------------------------------------------------------------- helpers

  private async assertEditable(providerId: string, vehicleId: string) {
    const vehicle = await this.vehicles.getOwned(providerId, vehicleId);
    if (editability(vehicle.status) !== 'all') {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `Photos can be changed while the listing is a draft or changes were requested (it is ${vehicle.status.replace('_', ' ')})`,
        409,
      );
    }
    return vehicle;
  }

  /** Keeps sort orders dense (0..n-1) after a removal so the primary is always order 0. */
  private async renumber(tx: DatabaseExecutor, vehicleId: string): Promise<void> {
    await tx.execute(sql`
      update ${vehiclePhotos} p
         set sort_order = ranked.rn - 1
        from (
          select id, row_number() over (order by sort_order, created_at) as rn
            from ${vehiclePhotos}
           where vehicle_id = ${vehicleId} and deleted_at is null
        ) ranked
       where p.id = ranked.id and p.sort_order <> ranked.rn - 1
    `);
  }
}
