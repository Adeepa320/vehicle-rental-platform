import { formatLkr, type PublicVehicleCard } from '@vrp/contracts';
import { MapPin, Truck } from 'lucide-react';
import Link from 'next/link';

import { RatingSummaryLine } from '@/components/reviews/rating-stars';
import { vehicleHref, type SearchState } from '@/lib/search-params';
import { FUEL_LABEL, TRANSMISSION_LABEL } from '@/lib/vehicle-labels';
import { categoryName, type ReferenceData } from '@/lib/reference';

import { Photo, photoSrc } from './photo';
import { ProviderTrustBadge, VehicleVerifiedBadge } from './trust-badge';

interface VehicleCardProps {
  card: PublicVehicleCard;
  state?: Pick<SearchState, 'startDate' | 'endDate'>;
  reference?: ReferenceData;
  highlighted?: boolean;
  /** Eager-load the photo (first result above the fold). */
  priority?: boolean;
}

/**
 * Customer-facing search result. Everything shown here is already customer-safe
 * (public API). The title link is stretched over the whole card, so the card is
 * one keyboard stop and one click target.
 */
export function VehicleCard({ card, state, reference, highlighted, priority }: VehicleCardProps) {
  const href = vehicleHref(card.slug, state);
  const specs = [
    categoryName(reference, card.categoryId),
    card.transmission ? TRANSMISSION_LABEL[card.transmission] : null,
    card.fuelType ? FUEL_LABEL[card.fuelType] : null,
    card.seats ? `${card.seats} seats` : null,
    card.hasAc ? 'AC' : null,
  ].filter(Boolean);
  const identity = `${card.make} ${card.model} ${card.modelYear}`;
  // Many titles already read "Toyota Prius 2023"; do not say it twice.
  const subtitle = card.title.toLowerCase().startsWith(identity.toLowerCase())
    ? specs.join(' · ')
    : `${identity} · ${specs.join(' · ')}`;
  const terms = [
    `Deposit ${formatLkr(card.pricing.securityDeposit)}`,
    card.pricing.includedKmPerDay === null
      ? 'Unlimited km'
      : `${card.pricing.includedKmPerDay} km/day, extra ${formatLkr(card.pricing.extraKmRate)}/km`,
    `Min ${card.pricing.minRentalDays} day${card.pricing.minRentalDays === 1 ? '' : 's'}`,
  ];
  return (
    <article
      className={`group bg-card relative flex flex-col overflow-hidden rounded-xl border shadow-xs transition-shadow focus-within:shadow-md hover:shadow-md sm:flex-row ${highlighted ? 'ring-teal ring-2' : ''}`}
      data-vehicle-id={card.id}
      aria-labelledby={`vehicle-${card.id}-title`}
    >
      <Photo
        src={photoSrc(card.photo, 'medium')}
        alt={`${card.title} – photo 1`}
        className="aspect-[4/3] w-full shrink-0 rounded-none sm:aspect-auto sm:min-h-52 sm:w-64 md:w-72"
        sizes="(max-width: 640px) 100vw, 288px"
        priority={priority}
        imgClassName="motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.03]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 xl:flex-row xl:gap-6 xl:p-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="space-y-1">
            <h3 className="text-lg leading-snug font-semibold">
              <Link
                id={`vehicle-${card.id}-title`}
                href={href}
                className="text-foreground decoration-teal underline-offset-4 outline-none group-hover:underline after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/60"
              >
                {card.title}
              </Link>
            </h3>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          </div>
          <div className="text-muted-foreground flex flex-col gap-1 text-sm">
            <p className="flex items-start gap-1.5">
              <MapPin className="text-teal mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <span className="text-foreground font-medium">{card.place.name}</span>
                {card.distanceKm !== null ? ` · ${card.distanceKm} km from the search centre` : ''}
              </span>
            </p>
            {card.deliveryAvailable ? (
              <p className="flex items-start gap-1.5">
                <Truck className="text-teal mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Delivery {card.deliveryFee ? formatLkr(card.deliveryFee) : 'on request'}
                </span>
              </p>
            ) : null}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-sm">
            <span className="text-foreground font-medium break-words">
              {card.provider.displayName}
            </span>
            <ProviderTrustBadge documentsVerified={card.provider.documentsVerified} />
            {card.documentsVerified ? <VehicleVerifiedBadge /> : null}
            {card.rating.count > 0 ? (
              <RatingSummaryLine summary={card.rating} compact />
            ) : (
              <span className="text-muted-foreground">No reviews yet</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t pt-3 xl:w-52 xl:shrink-0 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6 xl:text-right">
          <p className="leading-tight">
            <span className="text-2xl font-bold tracking-tight">
              {formatLkr(card.pricing.dailyRate)}
            </span>
            <span className="text-muted-foreground text-sm"> / day</span>
          </p>
          <ul className="text-muted-foreground grid gap-0.5 text-xs">
            {terms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
          {card.estimate ? (
            <p className="bg-teal-soft text-teal-strong mt-auto rounded-md px-2.5 py-1.5 text-sm">
              <span className="font-semibold">{formatLkr(card.estimate.subtotal)}</span> estimated
              for {card.estimate.days} day{card.estimate.days === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
