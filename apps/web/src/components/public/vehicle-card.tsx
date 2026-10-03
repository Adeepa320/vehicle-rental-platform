import { formatLkr, type PublicVehicleCard } from '@vrp/contracts';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { vehicleHref, type SearchState } from '@/lib/search-params';
import { FUEL_LABEL, TRANSMISSION_LABEL } from '@/lib/vehicle-labels';
import { categoryName, type ReferenceData } from '@/lib/reference';

import { Photo, photoSrc } from './photo';

interface VehicleCardProps {
  card: PublicVehicleCard;
  state?: Pick<SearchState, 'startDate' | 'endDate'>;
  reference?: ReferenceData;
  highlighted?: boolean;
}

/** Customer-facing search result. Everything shown here is already customer-safe (public API). */
export function VehicleCard({ card, state, reference, highlighted }: VehicleCardProps) {
  const href = vehicleHref(card.slug, state);
  const specs = [
    categoryName(reference, card.categoryId),
    card.transmission ? TRANSMISSION_LABEL[card.transmission] : null,
    card.fuelType ? FUEL_LABEL[card.fuelType] : null,
    card.seats ? `${card.seats} seats` : null,
    card.hasAc ? 'AC' : null,
  ].filter(Boolean);
  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row ${highlighted ? 'ring-ring ring-2' : ''}`}
      data-vehicle-id={card.id}
    >
      <Link href={href} className="block w-full shrink-0 sm:w-56">
        <Photo
          src={photoSrc(card.photo, 'medium')}
          alt={card.title}
          className="aspect-[4/3] w-full"
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <Link href={href} className="text-lg font-semibold underline-offset-4 hover:underline">
            {card.title}
          </Link>
          <p className="text-muted-foreground text-sm">
            {card.make} {card.model} {card.modelYear} · {specs.join(' · ')}
          </p>
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
          <span>{card.place.name}</span>
          {card.distanceKm !== null ? (
            <span>· {card.distanceKm} km from the search centre</span>
          ) : null}
          {card.deliveryAvailable ? (
            <span>· Delivery {card.deliveryFee ? formatLkr(card.deliveryFee) : 'on request'}</span>
          ) : null}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{card.provider.displayName}</span>
          <Badge variant="secondary">Platform-approved provider</Badge>
        </p>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2">
          <div className="text-sm">
            <p>
              <span className="text-xl font-semibold">{formatLkr(card.pricing.dailyRate)}</span>
              <span className="text-muted-foreground"> / day</span>
            </p>
            <p className="text-muted-foreground text-xs">
              Deposit {formatLkr(card.pricing.securityDeposit)} ·{' '}
              {card.pricing.includedKmPerDay === null
                ? 'Unlimited km'
                : `${card.pricing.includedKmPerDay} km/day, extra ${formatLkr(card.pricing.extraKmRate)}/km`}{' '}
              · Min {card.pricing.minRentalDays} day{card.pricing.minRentalDays === 1 ? '' : 's'}
            </p>
          </div>
          {card.estimate ? (
            <p className="text-right text-sm">
              <span className="font-medium">{formatLkr(card.estimate.subtotal)}</span>
              <span className="text-muted-foreground">
                {' '}
                estimated for {card.estimate.days} day{card.estimate.days === 1 ? '' : 's'}
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
