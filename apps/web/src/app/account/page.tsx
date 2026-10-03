'use client';

import { UpdateProfileRequestSchema, type UpdateProfileRequest, type User } from '@vrp/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'si', label: 'සිංහල (Sinhala)' },
  { value: 'ta', label: 'தமிழ் (Tamil)' },
] as const;
const CURRENCIES = ['LKR', 'USD', 'EUR', 'GBP', 'AUD'] as const;

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

export default function AccountPage() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login?next=/account');
  }, [router, status]);

  if (status !== 'authenticated' || !user) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading your account…</p>
      </main>
    );
  }

  // Keyed by user id so a different account always starts from its own values.
  return <AccountView key={user.id} user={user} />;
}

function formFromUser(user: User) {
  return {
    fullName: user.fullName,
    phone: user.phone ?? '',
    preferredLanguage: user.preferredLanguage as string,
    preferredCurrency: user.preferredCurrency as string,
    countryCode: user.countryCode ?? '',
  };
}

function AccountView({ user }: { user: User }) {
  const { updateProfile, logout, logoutAll } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState(() => formFromUser(user));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{
    variant: 'default' | 'destructive';
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const patch: UpdateProfileRequest = {
      fullName: form.fullName,
      phone: form.phone.trim() === '' ? null : form.phone.trim(),
      preferredLanguage: form.preferredLanguage as UpdateProfileRequest['preferredLanguage'],
      preferredCurrency: form.preferredCurrency as UpdateProfileRequest['preferredCurrency'],
      countryCode: form.countryCode.trim() === '' ? null : form.countryCode.trim().toUpperCase(),
    };
    const parsed = UpdateProfileRequestSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await updateProfile(parsed.data);
      setMessage({ variant: 'default', text: 'Profile saved.' });
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage({ variant: 'destructive', text: failure.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <AuthCard title="Your account" description={user.email}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={user.emailVerified ? 'default' : 'destructive'}>
            {user.emailVerified ? 'Email verified' : 'Email not verified'}
          </Badge>
          {user.roles.map((role) => (
            <Badge key={role} variant="outline">
              {role}
            </Badge>
          ))}
          <span className="text-muted-foreground">
            Member since {new Date(user.createdAt).toLocaleDateString('en-GB')}
          </span>
        </div>
      </AuthCard>

      <AuthCard title="Profile" description="Basic details used when you book.">
        <form className="grid gap-4" onSubmit={onSave} noValidate>
          {message ? <FormMessage variant={message.variant}>{message.text}</FormMessage> : null}
          <FormField id="fullName" label="Full name" error={errors.fullName}>
            <Input
              id="fullName"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </FormField>
          <FormField
            id="phone"
            label="Phone (optional)"
            error={errors.phone}
            hint="International format, e.g. +94771234567. Not verified yet."
          >
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="preferredLanguage" label="Language" error={errors.preferredLanguage}>
              <select
                id="preferredLanguage"
                className={selectClass}
                value={form.preferredLanguage}
                onChange={(e) => setForm({ ...form, preferredLanguage: e.target.value })}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              id="preferredCurrency"
              label="Display currency"
              error={errors.preferredCurrency}
            >
              <select
                id="preferredCurrency"
                className={selectClass}
                value={form.preferredCurrency}
                onChange={(e) => setForm({ ...form, preferredCurrency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              id="countryCode"
              label="Country (optional)"
              error={errors.countryCode}
              hint="Two letters, e.g. LK"
            >
              <Input
                id="countryCode"
                maxLength={2}
                value={form.countryCode}
                onChange={(e) => setForm({ ...form, countryCode: e.target.value })}
              />
            </FormField>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </AuthCard>

      <AuthCard title="Sessions" description="Sign out of this browser or of every device at once.">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await logout();
              router.push('/');
            }}
          >
            Log out
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              await logoutAll();
              router.push('/login');
            }}
          >
            Log out everywhere
          </Button>
        </div>
      </AuthCard>
    </main>
  );
}
