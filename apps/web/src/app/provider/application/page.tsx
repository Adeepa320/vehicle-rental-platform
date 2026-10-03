'use client';

import {
  ProviderApplicationDraftSchema,
  type ProviderApplication,
  type ProviderApplicationDraft,
} from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import { fromApplication, toDraft, type FormState } from '@/lib/provider-form';
import { APPLICATION_STATUS, PROVIDER_TYPE_LABEL, formatDate } from '@/lib/provider-labels';
import { useReferenceData, type ReferenceData } from '@/lib/reference';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

export default function ProviderApplicationPage() {
  const gate = useRequireAuth();
  const { withAccessToken, api } = useAuth();
  const reference = useReferenceData();
  const [application, setApplication] = useState<ProviderApplication | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (gate !== 'ready') return;
    let cancelled = false;
    withAccessToken((token) => api.providers.myApplication(token))
      .then((result) => {
        if (!cancelled) setApplication(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(submitErrorFrom(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, withAccessToken]);

  if (gate !== 'ready' || application === undefined || reference.status === 'loading') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <p className="text-muted-foreground text-sm">{loadError ?? 'Loading your application…'}</p>
      </main>
    );
  }
  if (reference.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <FormMessage variant="destructive">{reference.message}</FormMessage>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <ApplicationStatus application={application} />
      {application?.status === 'approved' ? null : application?.status === 'rejected' ? null : (
        <ApplicationForm
          key={application?.updatedAt ?? 'new'}
          application={application}
          reference={reference.data}
          onSaved={setApplication}
        />
      )}
      {application && (application.status === 'approved' || application.status === 'rejected') ? (
        <ReadOnlySummary application={application} reference={reference.data} />
      ) : null}
    </main>
  );
}

function ApplicationStatus({ application }: { application: ProviderApplication | null }) {
  if (!application) {
    return (
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Provider application</h1>
        <p className="text-muted-foreground">
          Tell us about your rental business. You can save a draft and come back later. Our team
          reviews applications manually and may contact you by phone.
        </p>
      </header>
    );
  }
  const meta = APPLICATION_STATUS[application.status];
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Provider application</h1>
        <Badge variant={meta.tone}>{meta.label}</Badge>
      </div>
      <p className="text-muted-foreground">{meta.description}</p>
      {application.reviewReason &&
      (application.status === 'changes_requested' || application.status === 'rejected') ? (
        <FormMessage variant="destructive" title="Message from our review team">
          <p className="whitespace-pre-wrap">{application.reviewReason}</p>
        </FormMessage>
      ) : null}
      {application.status === 'approved' ? (
        <Button nativeButton={false} render={<Link href="/provider/dashboard" />}>
          Open provider dashboard
        </Button>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {application.submittedAt ? `Submitted ${formatDate(application.submittedAt)} · ` : ''}
        Last updated {formatDate(application.updatedAt)}
      </p>
    </header>
  );
}

function ApplicationForm({
  application,
  reference,
  onSaved,
}: {
  application: ProviderApplication | null;
  reference: ReferenceData;
  onSaved: (application: ProviderApplication) => void;
}) {
  const { withAccessToken, api } = useAuth();
  const [form, setForm] = useState<FormState>(() => fromApplication(application));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{
    variant: 'default' | 'destructive';
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [agree, setAgree] = useState(false);

  const editable = application ? application.canEdit : true;
  const activeDistricts = reference.districts.filter((d) => d.isActive);
  const placesInDistrict = reference.places.filter((p) => p.districtId === form.districtId);
  const serviceAreaOptions = reference.places.filter(
    (p) => activeDistricts.some((d) => d.id === p.districtId) && p.id !== form.primaryPlaceId,
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggle = (
    key: 'serviceAreaPlaceIds' | 'vehicleCategoryIds',
    id: string,
    checked: boolean,
  ) =>
    setForm((current) => ({
      ...current,
      [key]: checked ? [...new Set([...current[key], id])] : current[key].filter((v) => v !== id),
    }));

  async function save(thenSubmit: boolean, event?: FormEvent) {
    event?.preventDefault();
    setMessage(null);
    const parsed = ProviderApplicationDraftSchema.safeParse(toDraft(form));
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setBusy(thenSubmit ? 'submit' : 'save');
    try {
      const saved = await withAccessToken((token) =>
        api.providers.saveApplication(token, parsed.data as ProviderApplicationDraft),
      );
      if (!thenSubmit) {
        onSaved(saved);
        setMessage({ variant: 'default', text: 'Draft saved.' });
        return;
      }
      const submitted = await withAccessToken((token) => api.providers.submitApplication(token));
      onSaved(submitted);
    } catch (error) {
      const failure = submitErrorFrom(error);
      setErrors(failure.fields);
      setMessage({
        variant: 'destructive',
        text:
          Object.keys(failure.fields).length > 0
            ? `${failure.message} Please check the highlighted fields.`
            : failure.message,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form className="grid gap-6" onSubmit={(e) => void save(true, e)} noValidate>
      {message ? <FormMessage variant={message.variant}>{message.text}</FormMessage> : null}

      <AuthCard title="Business" description="How customers will see you.">
        <div className="grid gap-4">
          <FormField id="displayName" label="Business or display name" error={errors.displayName}>
            <Input
              id="displayName"
              value={form.displayName}
              disabled={!editable}
              onChange={(e) => update('displayName', e.target.value)}
            />
          </FormField>
          <FormField id="providerType" label="Provider type" error={errors.providerType}>
            <select
              id="providerType"
              className={selectClass}
              value={form.providerType}
              disabled={!editable}
              onChange={(e) => update('providerType', e.target.value as FormState['providerType'])}
            >
              <option value="">Select…</option>
              {(Object.keys(PROVIDER_TYPE_LABEL) as (keyof typeof PROVIDER_TYPE_LABEL)[]).map(
                (t) => (
                  <option key={t} value={t}>
                    {PROVIDER_TYPE_LABEL[t]}
                  </option>
                ),
              )}
            </select>
          </FormField>
          <FormField
            id="description"
            label="Short description"
            error={errors.description}
            hint="20–1000 characters. What you rent, who you serve, what makes you reliable."
          >
            <Textarea
              id="description"
              value={form.description}
              disabled={!editable}
              onChange={(e) => update('description', e.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="yearsOperating"
              label="Years operating (optional)"
              error={errors.yearsOperating}
            >
              <Input
                id="yearsOperating"
                type="number"
                min={0}
                max={100}
                value={form.yearsOperating}
                disabled={!editable}
                onChange={(e) => update('yearsOperating', e.target.value)}
              />
            </FormField>
            <FormField
              id="fleetSizeEstimate"
              label="Approximate fleet size (optional)"
              error={errors.fleetSizeEstimate}
            >
              <Input
                id="fleetSizeEstimate"
                type="number"
                min={1}
                max={500}
                value={form.fleetSizeEstimate}
                disabled={!editable}
                onChange={(e) => update('fleetSizeEstimate', e.target.value)}
              />
            </FormField>
          </div>
          <FormField
            id="websiteUrl"
            label="Website or social page (optional)"
            error={errors.websiteUrl}
            hint="Must start with http:// or https://"
          >
            <Input
              id="websiteUrl"
              type="url"
              value={form.websiteUrl}
              disabled={!editable}
              onChange={(e) => update('websiteUrl', e.target.value)}
            />
          </FormField>
        </div>
      </AuthCard>

      <AuthCard
        title="Contact"
        description="We use these to reach you during review and for bookings later."
      >
        <div className="grid gap-4">
          <FormField id="contactName" label="Contact person" error={errors.contactName}>
            <Input
              id="contactName"
              value={form.contactName}
              disabled={!editable}
              onChange={(e) => update('contactName', e.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="phone"
              label="Phone"
              error={errors.phone}
              hint="International format, e.g. +94771234567. Not verified automatically yet."
            >
              <Input
                id="phone"
                type="tel"
                value={form.phone}
                disabled={!editable}
                onChange={(e) => update('phone', e.target.value)}
              />
            </FormField>
            <FormField
              id="whatsapp"
              label="WhatsApp (optional, if different)"
              error={errors.whatsapp}
            >
              <Input
                id="whatsapp"
                type="tel"
                value={form.whatsapp}
                disabled={!editable}
                onChange={(e) => update('whatsapp', e.target.value)}
              />
            </FormField>
          </div>
        </div>
      </AuthCard>

      <AuthCard title="Where you operate" description="Launch area: Matara and Galle districts.">
        <div className="grid gap-4">
          <FormField id="districtId" label="District" error={errors.districtId}>
            <select
              id="districtId"
              className={selectClass}
              value={form.districtId}
              disabled={!editable}
              onChange={(e) =>
                setForm((c) => ({ ...c, districtId: e.target.value, primaryPlaceId: '' }))
              }
            >
              <option value="">Select…</option>
              {activeDistricts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="primaryPlaceId"
            label="Primary operating town or area"
            error={errors.primaryPlaceId}
          >
            <select
              id="primaryPlaceId"
              className={selectClass}
              value={form.primaryPlaceId}
              disabled={!editable || !form.districtId}
              onChange={(e) => update('primaryPlaceId', e.target.value)}
            >
              <option value="">{form.districtId ? 'Select…' : 'Choose a district first'}</option>
              {placesInDistrict.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="addressText" label="Address or operating base" error={errors.addressText}>
            <Textarea
              id="addressText"
              className="min-h-14"
              value={form.addressText}
              disabled={!editable}
              onChange={(e) => update('addressText', e.target.value)}
            />
          </FormField>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Additional service areas (optional)</legend>
            {errors.serviceAreaPlaceIds ? (
              <p className="text-destructive text-xs">{errors.serviceAreaPlaceIds}</p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {serviceAreaOptions.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.serviceAreaPlaceIds.includes(p.id)}
                    disabled={!editable}
                    onCheckedChange={(checked) =>
                      toggle('serviceAreaPlaceIds', p.id, checked === true)
                    }
                  />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.offersDelivery}
                disabled={!editable}
                onCheckedChange={(checked) => update('offersDelivery', checked === true)}
              />
              <span>I can deliver vehicles to the customer</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.offersAirportTransfer}
                disabled={!editable}
                onCheckedChange={(checked) => update('offersAirportTransfer', checked === true)}
              />
              <span>I offer airport handover / transfers</span>
            </label>
          </div>
        </div>
      </AuthCard>

      <AuthCard title="Vehicles" description="Which vehicle types do you rent?">
        <fieldset className="grid gap-2">
          {errors.vehicleCategoryIds ? (
            <p className="text-destructive text-xs">{errors.vehicleCategoryIds}</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {reference.categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.vehicleCategoryIds.includes(c.id)}
                  disabled={!editable}
                  onCheckedChange={(checked) =>
                    toggle('vehicleCategoryIds', c.id, checked === true)
                  }
                />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4">
          <FormField
            id="applicantNotes"
            label="Anything else we should know? (optional)"
            error={errors.applicantNotes}
          >
            <Textarea
              id="applicantNotes"
              className="min-h-14"
              value={form.applicantNotes}
              disabled={!editable}
              onChange={(e) => update('applicantNotes', e.target.value)}
            />
          </FormField>
        </div>
      </AuthCard>

      {editable ? (
        <AuthCard title="Submit for review">
          <div className="grid gap-4">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={agree} onCheckedChange={(checked) => setAgree(checked === true)} />
              <span>
                I confirm the information is accurate and accept the provider agreement (version
                2026-10). I understand the platform reviews applications manually and may contact me
                to confirm details.
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void save(false)}
              >
                {busy === 'save' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button type="submit" disabled={busy !== null || !agree}>
                {busy === 'submit'
                  ? 'Submitting…'
                  : application?.status === 'changes_requested'
                    ? 'Resubmit application'
                    : 'Submit application'}
              </Button>
            </div>
          </div>
        </AuthCard>
      ) : null}
    </form>
  );
}

function ReadOnlySummary({
  application,
  reference,
}: {
  application: ProviderApplication;
  reference: ReferenceData;
}) {
  const rows: [string, string][] = [
    ['Business', application.displayName ?? '—'],
    ['Type', application.providerType ? PROVIDER_TYPE_LABEL[application.providerType] : '—'],
    ['Contact', `${application.contactName ?? '—'} · ${application.phone ?? '—'}`],
    ['District', reference.districts.find((d) => d.id === application.districtId)?.name ?? '—'],
    [
      'Primary place',
      reference.places.find((p) => p.id === application.primaryPlaceId)?.name ?? '—',
    ],
    [
      'Vehicle types',
      application.vehicleCategoryIds
        .map((id) => reference.categories.find((c) => c.id === id)?.name ?? id)
        .join(', ') || '—',
    ],
  ];
  return (
    <AuthCard title="Application details">
      <dl className="grid gap-2 text-sm sm:grid-cols-[160px_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </AuthCard>
  );
}
