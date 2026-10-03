'use client';

import {
  MAX_PHOTO_BYTES,
  MAX_VEHICLE_PHOTOS,
  MIN_VEHICLE_PHOTOS,
  type VehiclePhoto,
} from '@vrp/contracts';
import { useRef, useState } from 'react';

import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { Photo } from '@/components/public/photo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom } from '@/lib/forms';

interface PhotoManagerProps {
  vehicleId: string;
  photos: VehiclePhoto[];
  /** Photos can change while the listing is a draft or changes were requested. */
  editable: boolean;
  /** Called after any change so the parent can refresh the submission checklist. */
  onChanged: (photos: VehiclePhoto[]) => void;
}

/**
 * Upload, order and remove listing photos. The first photo is the primary one.
 * Files are validated again by the API (real format, size, dimensions), which
 * also strips metadata and produces the public variants.
 */
export function PhotoManager({ vehicleId, photos, editable, onChanged }: PhotoManagerProps) {
  const { api, withAccessToken } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<VehiclePhoto[]>) {
    setBusy(label);
    setError(null);
    try {
      onChanged(await fn());
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, MAX_VEHICLE_PHOTOS - photos.length);
    const tooBig = list.find((f) => f.size > MAX_PHOTO_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is larger than ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    await run('upload', async () => {
      for (const [index, file] of list.entries()) {
        setBusy(`Uploading ${index + 1} of ${list.length}…`);
        await withAccessToken((t) => api.vehicles.uploadPhoto(t, vehicleId, file));
      }
      return withAccessToken((t) => api.vehicles.listPhotos(t, vehicleId));
    });
    if (input.current) input.current.value = '';
  }

  const move = (index: number, delta: number) => {
    const ids = photos.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void run('reorder', () =>
      withAccessToken((t) => api.vehicles.reorderPhotos(t, vehicleId, ids)),
    );
  };

  const remove = (photoId: string) =>
    run('remove', async () => {
      await withAccessToken((t) => api.vehicles.deletePhoto(t, vehicleId, photoId));
      return withAccessToken((t) => api.vehicles.listPhotos(t, vehicleId));
    });

  const missing = Math.max(0, MIN_VEHICLE_PHOTOS - photos.length);
  return (
    <AuthCard
      title="Photos"
      description={`${MIN_VEHICLE_PHOTOS}–${MAX_VEHICLE_PHOTOS} photos, JPEG/PNG/WebP up to 10 MB each. The first photo is shown in search results. Location data and other metadata are removed automatically.`}
    >
      <div className="grid gap-4">
        {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
        {missing > 0 ? (
          <p className="text-sm">
            <Badge variant="destructive">
              {missing} more photo{missing === 1 ? '' : 's'} needed
            </Badge>{' '}
            <span className="text-muted-foreground">before the listing can be submitted.</span>
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {photos.length} photo{photos.length === 1 ? '' : 's'} · minimum met.
          </p>
        )}
        {!editable ? (
          <p className="text-muted-foreground text-sm">
            Photos can be changed while the listing is a draft or when changes are requested.
          </p>
        ) : null}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, index) => (
            <li key={photo.id} className="grid gap-2 rounded-md border p-2">
              <Photo
                src={photo.variants.medium}
                alt={`Photo ${index + 1}`}
                className="aspect-[4/3] w-full"
              />
              <div className="flex flex-wrap items-center justify-between gap-1">
                {photo.isPrimary ? (
                  <Badge>Primary</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">#{index + 1}</span>
                )}
                {editable ? (
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy !== null || index === 0}
                      onClick={() => move(index, -1)}
                      aria-label="Move earlier"
                    >
                      ↑
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy !== null || index === photos.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label="Move later"
                    >
                      ↓
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void remove(photo.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {editable && photos.length < MAX_VEHICLE_PHOTOS ? (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy !== null}
              onChange={(e) => void upload(e.target.files)}
              className="text-sm"
              aria-label="Add photos"
            />
            {busy ? <span className="text-muted-foreground text-xs">{busy}</span> : null}
          </div>
        ) : null}
      </div>
    </AuthCard>
  );
}
