import { Inject, Injectable } from '@nestjs/common';
import type { UpdateProviderProfileRequest } from '@vrp/contracts';
import {
  providerProfiles,
  providerServiceAreas,
  providerVehicleCategories,
  type Database,
  type DatabaseExecutor,
  type ProviderProfile,
} from '@vrp/database';
import { eq } from 'drizzle-orm';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.types';
import type { ProfileRelations } from './provider.mappers';

export interface ProviderProfileWithRelations {
  profile: ProviderProfile;
  relations: ProfileRelations;
}

/** Provider profiles (created on approval) and the provider's own edits. */
@Injectable()
export class ProvidersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async findByUserId(
    userId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<ProviderProfile | undefined> {
    const [row] = await executor
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, userId))
      .limit(1);
    return row;
  }

  async findById(id: string): Promise<ProviderProfile | undefined> {
    const [row] = await this.db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.id, id))
      .limit(1);
    return row;
  }

  async relationsFor(
    providerId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<ProfileRelations> {
    const [areas, categories] = await Promise.all([
      executor
        .select({ placeId: providerServiceAreas.placeId })
        .from(providerServiceAreas)
        .where(eq(providerServiceAreas.providerId, providerId)),
      executor
        .select({ categoryId: providerVehicleCategories.categoryId })
        .from(providerVehicleCategories)
        .where(eq(providerVehicleCategories.providerId, providerId)),
    ]);
    return {
      serviceAreaPlaceIds: areas.map((a) => a.placeId),
      vehicleCategoryIds: categories.map((c) => c.categoryId),
    };
  }

  async getMine(userId: string): Promise<ProviderProfileWithRelations | undefined> {
    const profile = await this.findByUserId(userId);
    if (!profile) return undefined;
    return { profile, relations: await this.relationsFor(profile.id) };
  }

  /** Contact/description edits by the (active) provider. Identity and status fields are not editable here. */
  async updateMine(
    userId: string,
    patch: UpdateProviderProfileRequest,
    meta: RequestMeta,
  ): Promise<ProviderProfileWithRelations> {
    const existing = await this.findByUserId(userId);
    if (!existing) throw new ApiException('NOT_FOUND', 'Provider profile not found', 404);
    if (existing.status !== 'active') {
      throw new ApiException('PROVIDER_SUSPENDED', 'Your provider account is suspended', 403);
    }

    const [updated] = await this.db
      .update(providerProfiles)
      .set({
        ...(patch.contactName !== undefined ? { contactName: patch.contactName } : {}),
        ...(patch.phone !== undefined ? { phoneE164: patch.phone, phoneVerifiedAt: null } : {}),
        ...(patch.whatsapp !== undefined ? { whatsappE164: patch.whatsapp } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.addressText !== undefined ? { addressText: patch.addressText } : {}),
        ...(patch.websiteUrl !== undefined ? { websiteUrl: patch.websiteUrl } : {}),
        ...(patch.offersDelivery !== undefined ? { offersDelivery: patch.offersDelivery } : {}),
        ...(patch.offersAirportTransfer !== undefined
          ? { offersAirportTransfer: patch.offersAirportTransfer }
          : {}),
      })
      .where(eq(providerProfiles.id, existing.id))
      .returning();
    if (!updated) throw new ApiException('NOT_FOUND', 'Provider profile not found', 404);

    await this.audit.record({
      actorUserId: userId,
      actorType: 'provider',
      action: 'provider_profile.updated',
      targetType: 'provider_profile',
      targetId: updated.id,
      ip: meta.ip ?? null,
      metadata: { fields: Object.keys(patch) },
    });

    return { profile: updated, relations: await this.relationsFor(updated.id) };
  }
}
