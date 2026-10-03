import { z } from 'zod';

/**
 * Money is never a float. Amounts travel as decimal strings with at most two
 * fraction digits ("7500" or "7500.00"), are stored in PostgreSQL `numeric(12,2)`
 * and are compared through integer cents (`amountToCents`). The settlement
 * currency is LKR; a `currency` field accompanies amounts in responses so a
 * second currency can be added without changing shapes.
 */
export const CURRENCY = 'LKR' as const;
export const SettlementCurrencySchema = z.literal(CURRENCY);

/** Non-negative, up to ten integer digits and two decimals. */
export const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

/** True when the value is a well-formed amount string (safe to pass to the arithmetic helpers). */
export function isAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value.trim());
}

/** `abort` stops later refinements (bounds checks) from seeing a malformed string. */
export const LkrAmountSchema = z.string().trim().regex(AMOUNT_PATTERN, {
  message: 'enter an amount in LKR with at most two decimals',
  abort: true,
});
export type LkrAmount = z.infer<typeof LkrAmountSchema>;

/** Standard money object (API_DESIGN §1.2). */
export const MoneySchema = z.object({
  amount: LkrAmountSchema,
  currency: SettlementCurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

/** "7500.5" → 750050n. Throws on malformed input (validate with the schema first). */
export function amountToCents(amount: string): bigint {
  const match = /^(?<sign>-?)(?<whole>\d+)(?:\.(?<frac>\d{1,2}))?$/.exec(amount.trim());
  if (!match?.groups) throw new Error(`Invalid amount: ${amount}`);
  const { sign, whole, frac = '' } = match.groups as { sign: string; whole: string; frac?: string };
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
}

/** 750050n → "7500.50". */
export function centsToAmount(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Canonical two-decimal form ("7500" → "7500.00"), as PostgreSQL returns it. */
export function normalizeAmount(amount: string): string {
  return centsToAmount(amountToCents(amount));
}

export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = [amountToCents(a), amountToCents(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Multiplies an amount by an integer factor without leaving integer arithmetic. */
export function multiplyAmount(amount: string, factor: number): string {
  if (!Number.isInteger(factor)) throw new Error('factor must be an integer');
  return centsToAmount(amountToCents(amount) * BigInt(factor));
}

/** Human display, e.g. "LKR 7,500" (whole rupees when there are no cents). */
export function formatLkr(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const cents = amountToCents(amount);
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const rest = abs % 100n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0n ? '-' : ''}LKR ${grouped}${rest === 0n ? '' : `.${rest.toString().padStart(2, '0')}`}`;
}
