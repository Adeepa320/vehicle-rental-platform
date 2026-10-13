import { z } from 'zod';

import { amountToCents } from './money';

/**
 * Indicative display currencies (Phase 8, TECH_DECISIONS D60). LKR is the only
 * settlement, quote, snapshot and payment currency; everything here is a
 * courtesy conversion for display, clearly labelled as approximate. Rates are
 * operator-maintained platform settings (no paid FX API, no hard-coded
 * values); when none are configured the API says so and the UI shows LKR only.
 */
export const DisplayCurrencySchema = z.enum(['USD', 'EUR', 'GBP', 'AUD']);
export type DisplayCurrency = z.infer<typeof DisplayCurrencySchema>;

/** Shape of the `indicative_exchange_rates` platform setting (LKR → foreign, units of foreign per 1 LKR). */
export const IndicativeRatesSettingSchema = z.object({
  asOf: z.iso.datetime(),
  source: z.string().trim().min(1).max(120),
  rates: z.partialRecord(DisplayCurrencySchema, z.number().positive()),
});
export type IndicativeRatesSetting = z.infer<typeof IndicativeRatesSettingSchema>;

export const INDICATIVE_RATE_DISCLAIMER =
  'Indicative only. All prices, deposits and payments are in Sri Lankan rupees (LKR); converted amounts are approximate and the card issuer sets the actual rate.';

/** `GET /reference/exchange-rates`. */
export const ExchangeRatesResponseSchema = z.object({
  base: z.literal('LKR'),
  /** False when no rates are configured: the UI shows LKR only. */
  available: z.boolean(),
  asOf: z.iso.datetime().nullable(),
  source: z.string().nullable(),
  rates: z.partialRecord(DisplayCurrencySchema, z.number().positive()),
  disclaimer: z.string(),
});
export type ExchangeRatesResponse = z.infer<typeof ExchangeRatesResponseSchema>;

/**
 * Display-only conversion of an LKR amount string with a unit rate. Works on
 * the integer cent value and rounds once to two decimals; the result is a
 * presentation string, never used for accounting.
 */
export function convertIndicative(amountLkr: string, rate: number): string {
  const cents = Number(amountToCents(amountLkr));
  const converted = Math.round(cents * rate) / 100;
  return converted.toFixed(2);
}

/** "≈ USD 12.34" for display; null when no rate exists for the currency. */
export function formatIndicative(
  amountLkr: string,
  currency: DisplayCurrency,
  rates: Partial<Record<DisplayCurrency, number>>,
): string | null {
  const rate = rates[currency];
  if (!rate) return null;
  const value = Number(convertIndicative(amountLkr, rate));
  return `≈ ${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
