'use client';

import {
  ACCEPTED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  UploadDocumentFieldsSchema,
  VehicleDocumentTypeSchema,
  requiredProviderDocumentTypes,
  type DocumentType,
  type ProviderDocument,
  type ProviderProfile,
  type VehicleSummary,
} from '@vrp/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  DOCUMENT_STATUS,
  DOCUMENT_TYPE_LABEL,
  PROVIDER_DOCUMENT_TYPES,
  VEHICLE_DOCUMENT_TYPES,
} from '@/lib/admin-labels';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { openBlobInNewTab } from '@/lib/blob';
import { formatDateTime } from '@/lib/booking-labels';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import { formatDay, vehicleTitle } from '@/lib/vehicle-labels';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

const isVehicleType = (type: DocumentType) =>
  (VehicleDocumentTypeSchema.options as readonly string[]).includes(type);

export default function ProviderDocumentsPage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const [documents, setDocuments] = useState<ProviderDocument[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [docs, list] = await Promise.all([
        withAccessToken((t) => api.providerDocuments.list(t, { includeHistory })),
        withAccessToken((t) => api.vehicles.list(t)),
      ]);
      setDocuments(docs.data);
      setVehicles(list);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    }
  }, [api, includeHistory, withAccessToken]);

  useEffect(() => {
    if (area.status !== 'ready') return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [area.status, load]);

  if (area.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <FormMessage variant="destructive">{area.message}</FormMessage>
      </main>
    );
  }
  if (area.status !== 'ready') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }

  const providerDocs = (documents ?? []).filter((d) => d.scope === 'provider');
  const vehicleDocs = (documents ?? []).filter((d) => d.scope === 'vehicle');
  const required = requiredProviderDocumentTypes(area.profile.providerType);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Verification documents</h1>
        <p className="text-muted-foreground text-sm">
          Documents are private: only you and the platform team can open them, and they are never
          shown to customers. Once approved and in date they add a “Verified provider” badge to your
          listings ({required.map((t) => DOCUMENT_TYPE_LABEL[t]).join(' and ')}) and a “Verified
          vehicle” badge per vehicle (certificate of registration, revenue licence and insurance).
          Uploading a document of the same type replaces the current one.
        </p>
      </header>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}

      <UploadForm profile={area.profile} vehicles={vehicles} onUploaded={() => void load()} />

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={includeHistory}
            onCheckedChange={(checked) => setIncludeHistory(checked === true)}
          />
          Show replaced documents
        </label>
      </div>

      <AuthCard title="Your provider documents">
        <DocumentList docs={providerDocs} loading={documents === null} />
      </AuthCard>

      {vehicles.map((vehicle) => {
        const docs = vehicleDocs.filter((d) => d.vehicleId === vehicle.id);
        return (
          <AuthCard key={vehicle.id} title={vehicleTitle(vehicle)} description="Vehicle documents.">
            <DocumentList docs={docs} loading={documents === null} />
          </AuthCard>
        );
      })}
    </main>
  );
}

function DocumentList({ docs, loading }: { docs: ProviderDocument[]; loading: boolean }) {
  const { api, withAccessToken } = useAuth();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (docs.length === 0)
    return <p className="text-muted-foreground text-sm">No documents uploaded yet.</p>;
  return (
    <ul className="grid gap-3">
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {docs.map((doc) => {
        const status = DOCUMENT_STATUS[doc.effectiveStatus];
        return (
          <li key={doc.id} className="grid gap-1 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{DOCUMENT_TYPE_LABEL[doc.type]}</span>
              <Badge variant={status.tone}>{status.label}</Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={opening === doc.id}
                onClick={async () => {
                  setOpening(doc.id);
                  setError(null);
                  try {
                    openBlobInNewTab(
                      await withAccessToken((t) => api.providerDocuments.content(t, doc.id)),
                    );
                  } catch (caught) {
                    setError(submitErrorFrom(caught).message);
                  } finally {
                    setOpening(null);
                  }
                }}
              >
                {opening === doc.id ? 'Opening…' : 'View'}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {status.description} Uploaded {formatDateTime(doc.createdAt)}
              {doc.documentNumber ? ` · no. ${doc.documentNumber}` : ''}
              {doc.issuedOn ? ` · issued ${formatDay(doc.issuedOn)}` : ''}
              {doc.expiresOn ? ` · expires ${formatDay(doc.expiresOn)}` : ''}
            </p>
            {doc.reviewReason ? (
              <p className="text-xs">
                <span className="text-muted-foreground">Message from the platform team:</span>{' '}
                {doc.reviewReason}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function UploadForm({
  profile,
  vehicles,
  onUploaded,
}: {
  profile: ProviderProfile;
  vehicles: VehicleSummary[];
  onUploaded: () => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [type, setType] = useState<DocumentType>('identity_document');
  const [vehicleId, setVehicleId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const vehicleType = isVehicleType(type);
  const providerTypes = PROVIDER_DOCUMENT_TYPES.filter(
    (t) => t !== 'business_registration' || profile.providerType === 'registered_business',
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSuccess(null);
    const fieldErrors: FieldErrors = {};
    if (!file) fieldErrors.file = 'Choose a PDF, JPEG or PNG file';
    else if (file.size > MAX_DOCUMENT_BYTES) fieldErrors.file = 'The file is larger than 10 MB';
    const parsed = UploadDocumentFieldsSchema.safeParse({
      type,
      ...(vehicleType && vehicleId ? { vehicleId } : {}),
      ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
      ...(issuedOn ? { issuedOn } : {}),
      ...(expiresOn ? { expiresOn } : {}),
    });
    if (!parsed.success) Object.assign(fieldErrors, fieldErrorsFromZod(parsed.error));
    if (Object.keys(fieldErrors).length > 0 || !file || !parsed.success) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const uploaded = await withAccessToken((t) =>
        api.providerDocuments.upload(t, file, parsed.data),
      );
      setSuccess(`${DOCUMENT_TYPE_LABEL[uploaded.type]} uploaded and queued for review.`);
      setFile(null);
      setDocumentNumber('');
      setIssuedOn('');
      setExpiresOn('');
      setFormKey((k) => k + 1);
      onUploaded();
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Upload a document"
      description="PDF, JPEG or PNG up to 10 MB. The file is checked by content, stored privately and never linked publicly."
    >
      <form key={formKey} className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
        {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
        {success ? <FormMessage>{success}</FormMessage> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="doc-type" label="Document type" error={errors.type}>
            <select
              id="doc-type"
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value as DocumentType)}
            >
              <optgroup label="Provider">
                {providerTypes.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABEL[t]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Vehicle">
                {VEHICLE_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABEL[t]}
                  </option>
                ))}
              </optgroup>
            </select>
          </FormField>
          {vehicleType ? (
            <FormField id="doc-vehicle" label="Vehicle" error={errors.vehicleId}>
              <select
                id="doc-vehicle"
                className={selectClass}
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">Choose…</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {vehicleTitle(v)}
                    {v.registrationNumber ? ` · ${v.registrationNumber}` : ''}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <FormField id="doc-file" label="File" error={errors.file}>
            <Input
              id="doc-file"
              type="file"
              accept={ACCEPTED_DOCUMENT_MIME_TYPES.join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </FormField>
          <FormField
            id="doc-number"
            label="Document / policy number (optional)"
            error={errors.documentNumber}
          >
            <Input
              id="doc-number"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
          </FormField>
          <FormField id="doc-issued" label="Issued on (optional)" error={errors.issuedOn}>
            <Input
              id="doc-issued"
              type="date"
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
            />
          </FormField>
          <FormField
            id="doc-expires"
            label="Expires on (optional)"
            error={errors.expiresOn}
            hint="For revenue licences and insurance; the team confirms it when approving."
          >
            <Input
              id="doc-expires"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
          </FormField>
        </div>
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
