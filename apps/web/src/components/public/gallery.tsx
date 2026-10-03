'use client';

import type { PublicPhoto } from '@vrp/contracts';
import { useState } from 'react';

import { Photo, photoSrc } from './photo';

/** Large image with a thumbnail strip; keyboard and touch friendly without a library. */
export function Gallery({ photos, title }: { photos: PublicPhoto[]; title: string }) {
  const [index, setIndex] = useState(0);
  const current = photos[index] ?? photos[0] ?? null;
  return (
    <div className="grid gap-2">
      <Photo
        src={photoSrc(current, 'large')}
        alt={`${title} – photo ${index + 1} of ${photos.length}`}
        className="aspect-[4/3] w-full"
        sizes="(max-width: 1024px) 100vw, 800px"
        priority
      />
      {photos.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto" aria-label="More photos">
          {photos.map((photo, i) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-pressed={i === index}
                className={`block w-24 shrink-0 rounded-md ${i === index ? 'ring-ring ring-2' : ''}`}
              >
                <Photo
                  src={photoSrc(photo, 'thumb')}
                  alt=""
                  className="aspect-[4/3] w-24"
                  sizes="96px"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
