'use client';

import { RegisterRequestSchema } from '@vrp/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

export default function RegisterPage() {
  const { register, api } = useAuth();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = RegisterRequestSchema.safeParse({
      fullName: form.fullName,
      email: form.email,
      password: form.password,
      acceptTerms: form.acceptTerms ? true : undefined,
    });
    const nextErrors = parsed.success ? {} : fieldErrorsFromZod(parsed.error);
    if (form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(nextErrors);
    if (!parsed.success || Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const result = await register(parsed.data);
      setRegisteredEmail(result.user.email);
    } catch (error) {
      const failure = submitErrorFrom(error);
      setErrors(failure.fields);
      setMessage(failure.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (registeredEmail) {
    return (
      <AuthCard
        title="Check your email"
        description={`We sent a verification link to ${registeredEmail}.`}
      >
        <div className="grid gap-4 text-sm">
          <p>Open the link to activate your account. It expires in 24 hours.</p>
          <p className="text-muted-foreground">
            Running locally? Open the Mailpit inbox at{' '}
            <a className="underline" href="http://localhost:8025" target="_blank" rel="noreferrer">
              localhost:8025
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={resent}
              onClick={async () => {
                await api.auth.resendVerification(registeredEmail);
                setResent(true);
              }}
            >
              {resent ? 'Link sent' : 'Resend link'}
            </Button>
            <Button nativeButton={false} render={<Link href="/login" />}>
              Go to login
            </Button>
          </div>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Search, compare and book vehicles across the South Coast."
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
        <FormField id="fullName" label="Full name" error={errors.fullName}>
          <Input
            id="fullName"
            autoComplete="name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            aria-invalid={Boolean(errors.fullName)}
          />
        </FormField>
        <FormField id="email" label="Email" error={errors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            aria-invalid={Boolean(errors.email)}
          />
        </FormField>
        <FormField
          id="password"
          label="Password"
          error={errors.password}
          hint="At least 10 characters."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            aria-invalid={Boolean(errors.password)}
          />
        </FormField>
        <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword}>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            aria-invalid={Boolean(errors.confirmPassword)}
          />
        </FormField>
        <div className="grid gap-1.5">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              id="acceptTerms"
              checked={form.acceptTerms}
              onCheckedChange={(checked) => setForm({ ...form, acceptTerms: checked === true })}
              aria-invalid={Boolean(errors.acceptTerms)}
            />
            <span>I accept the terms of service and privacy policy.</span>
          </label>
          {errors.acceptTerms ? (
            <p className="text-destructive text-xs" role="alert">
              {errors.acceptTerms}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-muted-foreground text-center text-sm">
          Already have an account?{' '}
          <Link href="/login" className="underline underline-offset-4">
            Log in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
