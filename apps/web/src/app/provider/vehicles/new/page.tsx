'use client';

import { CreateVehicleRequestSchema } from '@vrp/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import { useReferenceData } from '@/lib/reference';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

export default function NewVehiclePage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const reference = useReferenceData();
  const router = useRouter();
  const [form, setForm] = useState({
    categoryId: '',
    make: '',
    model: '',
    modelYear: '',
    title: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const text = (v: string) => (v.trim() === '' ? undefined : v.trim());
    const parsed = CreateVehicleRequestSchema.safeParse({
      categoryId: form.categoryId,
      make: text(form.make),
      model: text(form.model),
      modelYear: form.modelYear.trim() === '' ? undefined : Number(form.modelYear),
      title: text(form.title),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const created = await withAccessToken((t) => api.vehicles.create(t, parsed.data));
      router.push(`/provider/vehicles/${created.id}`);
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(failure.message);
      setBusy(false);
    }
  }

  if (area.status !== 'ready' || reference.status !== 'ready') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <p className="text-muted-foreground text-sm">
          {area.status === 'error'
            ? area.message
            : reference.status === 'error'
              ? reference.message
              : 'Loading…'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Add a vehicle</h1>
        <p className="text-muted-foreground text-sm">
          Start with the basics; pricing, rules and the pickup location come next, and you can save
          at any point.
        </p>
      </header>
      {area.profile.status === 'suspended' ? (
        <FormMessage variant="destructive" title="Your provider account is suspended">
          New listings cannot be created until the suspension is lifted.
        </FormMessage>
      ) : (
        <AuthCard title="Basics">
          <form className="grid gap-4" onSubmit={(e) => void create(e)} noValidate>
            {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
            <FormField id="categoryId" label="Category" error={errors.categoryId}>
              <select
                id="categoryId"
                className={selectClass}
                value={form.categoryId}
                onChange={(e) => setForm((c) => ({ ...c, categoryId: e.target.value }))}
              >
                <option value="">Select…</option>
                {reference.data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField id="make" label="Make" error={errors.make}>
                <Input
                  id="make"
                  value={form.make}
                  placeholder="Toyota"
                  onChange={(e) => setForm((c) => ({ ...c, make: e.target.value }))}
                />
              </FormField>
              <FormField id="model" label="Model" error={errors.model}>
                <Input
                  id="model"
                  value={form.model}
                  placeholder="Aqua"
                  onChange={(e) => setForm((c) => ({ ...c, model: e.target.value }))}
                />
              </FormField>
              <FormField id="modelYear" label="Year" error={errors.modelYear}>
                <Input
                  id="modelYear"
                  type="number"
                  value={form.modelYear}
                  placeholder="2018"
                  onChange={(e) => setForm((c) => ({ ...c, modelYear: e.target.value }))}
                />
              </FormField>
            </div>
            <FormField
              id="title"
              label="Listing title (optional for now)"
              error={errors.title}
              hint="What customers will see, e.g. “Toyota Aqua 2018 – automatic hybrid”."
            >
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))}
              />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create draft'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                nativeButton={false}
                render={<Link href="/provider/vehicles" />}
              >
                Cancel
              </Button>
            </div>
          </form>
        </AuthCard>
      )}
    </main>
  );
}
