'use client';

import type { PublicPhoto } from '@vrp/contracts';
import { cn } from 'cn';
import { CarFront } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

export type PhotoVariantName = keyof PublicPhoto['variants'];

/** URL of a variant, or null when there is no photo. */
export function photoSrc(
  photo: { variants: PublicPhoto['variants'] } | null | undefined,
  variant: PhotoVariantName,
): string | null {
  return photo?.variants[variant] ?? null;
}

interface PhotoProps {
  src: string | null;
  alt: string;
  /** Tailwind classes for the frame, e.g. `aspect-[4/3]`. */
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Extra classes for the `<img>` itself (e.g. a hover zoom driven by a parent group). */
  imgClassName?: string;
}

/**
 * Listing photo with a neutral fallback when there is no image or it fails to
 * load (storage down, deleted object). Variants are pre-sized WebP from our own
 * storage, so Next's optimizer is bypassed (`unoptimized`).
 */
export function Photo({ src, alt, className, sizes, priority, imgClassName }: PhotoProps) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn('bg-surface-subtle relative overflow-hidden rounded-md', className)}>
      {src && !failed ? (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes={sizes ?? '(max-width: 640px) 100vw, 400px'}
          priority={priority}
          className={cn('object-cover', imgClassName)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1.5 text-xs"
          {...(alt ? { role: 'img', 'aria-label': `${alt} (photo unavailable)` } : {})}
        >
          <CarFront className="size-7 opacity-50" aria-hidden />
          <span aria-hidden>Photo unavailable</span>
        </div>
      )}
    </div>
  );
}
