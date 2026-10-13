'use client';

import { formatIndicative, type DisplayCurrency, type ExchangeRatesResponse } from '@vrp/contracts';
import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';

let cached: Promise<ExchangeRatesResponse> | null = null;

/**
 * Approximate foreign-currency hint next to an LKR amount, shown only when the
 * signed-in user prefers another display currency and the operator has
 * configured indicative rates (TECH_DECISIONS D60). LKR stays the only
 * authoritative amount; nothing here feeds a quote or a payment.
 */
export function IndicativeAmount({
  amountLkr,
  inline = false,
  suffix = '',
}: {
  amountLkr: string;
  inline?: boolean;
  suffix?: string;
}) {
  const { api, user } = useAuth();
  const [rates, setRates] = useState<ExchangeRatesResponse | null>(null);
  const currency = user?.preferredCurrency;

  useEffect(() => {
    if (!currency || currency === 'LKR') return;
    let cancelled = false;
    cached ??= api.reference.exchangeRates();
    cached
      .then((r) => {
        if (!cancelled) setRates(r);
      })
      .catch(() => {
        cached = null;
      });
    return () => {
      cancelled = true;
    };
  }, [api, currency]);

  if (!currency || currency === 'LKR' || !rates?.available) return null;
  const text = formatIndicative(amountLkr, currency as DisplayCurrency, rates.rates);
  if (!text) return null;
  const title = `${rates.disclaimer} Rate as of ${rates.asOf ? new Date(rates.asOf).toLocaleDateString('en-GB') : 'unknown'}${rates.source ? `, source: ${rates.source}` : ''}.`;
  return inline ? (
    <span className="text-muted-foreground ml-1 text-xs font-normal" title={title}>
      {text}
      {suffix}
    </span>
  ) : (
    <p className="text-muted-foreground text-xs" title={title}>
      {text}
      {suffix} (indicative)
    </p>
  );
}
