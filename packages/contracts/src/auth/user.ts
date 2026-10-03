import { z } from 'zod';

export const UserRoleSchema = z.enum(['customer', 'provider', 'admin', 'super_admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

/** UI languages the platform supports (English first; Sinhala/Tamil UI later). */
export const LanguageSchema = z.enum(['en', 'si', 'ta']);
/** Display currencies; LKR is always the settlement currency. */
export const CurrencySchema = z.enum(['LKR', 'USD', 'EUR', 'GBP', 'AUD']);
/** ISO 3166-1 alpha-2, upper case. */
export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'must be a two-letter country code');
/** E.164 phone number, e.g. +94771234567. */
export const PhoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'must be an international number like +94771234567');

/** Normalised e-mail: trimmed, lower-cased, RFC-5322-ish, max 254 chars. */
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Public representation of the authenticated user. Never includes hashes or tokens. */
export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  fullName: z.string(),
  phone: PhoneE164Schema.nullable(),
  roles: z.array(UserRoleSchema),
  status: UserStatusSchema,
  preferredLanguage: LanguageSchema,
  preferredCurrency: CurrencySchema,
  countryCode: CountryCodeSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof UserSchema>;

/** `PATCH /users/me`. Unknown keys (e.g. `roles`) are rejected. */
export const UpdateProfileRequestSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: PhoneE164Schema.nullable().optional(),
  preferredLanguage: LanguageSchema.optional(),
  preferredCurrency: CurrencySchema.optional(),
  countryCode: CountryCodeSchema.nullable().optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
