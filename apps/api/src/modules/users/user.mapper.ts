import { CurrencySchema, LanguageSchema, type User as PublicUser } from '@vrp/contracts';
import type { User } from '@vrp/database';

/**
 * Explicit allow-list from the database row to the public contract. New
 * columns never leak unless added here (SECURITY_AND_PRIVACY.md §4).
 */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    fullName: user.fullName,
    phone: user.phoneE164,
    roles: user.roles,
    status: user.status,
    preferredLanguage: LanguageSchema.catch('en').parse(user.preferredLanguage),
    preferredCurrency: CurrencySchema.catch('LKR').parse(user.preferredCurrency),
    countryCode: user.countryCode,
    createdAt: user.createdAt.toISOString(),
  };
}
