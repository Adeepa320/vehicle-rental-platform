'use client';

import {
  DocumentEffectiveStatusSchema,
  type AdminDocument,
  type DocumentEffectiveStatus,
  type DocumentScope,
} from '@vrp/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { AdminShell, selectClass } from '@/components/admin/admin-shell';
import { ReasonAction } from '@/components/admin/reason-action';
import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DOCUMENT_STATUS, DOCUMENT_TYPE_LABEL } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { openBlobInNewTab } from '@/lib/blob';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { formatDay } from '@/lib/vehicle-labels';

export default function AdminDocumentsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl px-4 py-12">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      }
    >
      <AdminDocumentsQueue />
    </Suspense>
  );
}

function AdminDocumentsQueue() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const searchParams = useSearchParams();
  const providerId = searchParams.get('providerId') ?? undefined;
  const vehicleId = searchParams.get('vehicleId') ?? undefined;
  const scopedToOne = Boolean(providerId || vehicleId);
  const [status, setStatus] = useState<DocumentEffectiveStatus | ''>(scopedToOne ? '' : 'pending');
  const [scope, setScope] = useState<DocumentScope | ''>('');
  const [expiringWithinDays, setExpiringWithinDays] = useState('');
  const [rows, setRows] = useState<AdminDocument[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const expiring = expiringWithinDays.trim() === '' ? undefined : Number(expiringWithinDays);
  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((t) =>
          api.admin.listDocuments(t, {
            status: status || undefined,
            scope: scope || undefined,
            expiringWithinDays:
              expiring !== undefined && Number.isFinite(expiring) ? expiring : undefined,
            providerId,
            vehicleId,
            cursor,
            limit: 30,
          }),
        );
        setRows((current) => (cursor ? [...current, ...page.data] : page.data));
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setError(submitErrorFrom(caught).message);
      } finally {
        setLoading(false);
      }
    },
    [api, expiring, providerId, scope, status, vehicleId, withAccessToken],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, ready]);

  const replace = (updated: AdminDocument) =>
    setRows((current) => current.map((d) => (d.id === updated.id ? updated : d)));

  return (
    <AdminShell area={area} width="max-w-6xl">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Verification documents</h1>
        <p className="text-muted-foreground text-sm">
          Private uploads from providers. Viewing streams the file to you and is audited; nothing
          here is a shareable link. Approving with an expiry date drives the expiry reminders and
          the optional auto-pause. “Verified provider” / “Verified vehicle” badges derive from
          approved, in-date documents only.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as DocumentEffectiveStatus | '')}
        >
          <option value="">All statuses</option>
          {DocumentEffectiveStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {DOCUMENT_STATUS[s].label}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={scope}
          onChange={(e) => setScope(e.target.value as DocumentScope | '')}
        >
          <option value="">Provider and vehicle documents</option>
          <option value="provider">Provider documents</option>
          <option value="vehicle">Vehicle documents</option>
        </select>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          Expiring within
          <Input
            type="number"
            min={0}
            max={365}
            className="w-20"
            value={expiringWithinDays}
            onChange={(e) => setExpiringWithinDays(e.target.value)}
          />
          days
        </label>
      </div>
      {scopedToOne ? (
        <p className="text-muted-foreground text-xs">
          Showing documents of the selected {providerId ? 'provider' : 'vehicle'} only.{' '}
          <Link href="/admin/documents" className="underline underline-offset-4">
            Show the whole queue
          </Link>
        </p>
      ) : null}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {loading && rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Loading documents…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No documents match.</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onChanged={replace} />
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Button variant="outline" disabled={loading} onClick={() => void load(nextCursor)}>
          Load more
        </Button>
      ) : null}
    </AdminShell>
  );
}

function DocumentRow({
  doc,
  onChanged,
}: {
  doc: AdminDocument;
  onChanged: (doc: AdminDocument) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const [viewing, setViewing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = DOCUMENT_STATUS[doc.effectiveStatus];
  const canDecide = doc.effectiveStatus === 'pending';
  const expiry =
    doc.expiresOn === null
      ? 'No expiry'
      : `${formatDay(doc.expiresOn)}${
          doc.daysUntilExpiry === null
            ? ''
            : doc.daysUntilExpiry < 0
              ? ` (expired ${-doc.daysUntilExpiry} day${doc.daysUntilExpiry === -1 ? '' : 's'} ago)`
              : ` (${doc.daysUntilExpiry} day${doc.daysUntilExpiry === 1 ? '' : 's'} left)`
        }`;

  return (
    <li className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{DOCUMENT_TYPE_LABEL[doc.type]}</span>
        <Badge variant={status.tone}>{status.label}</Badge>
        <Badge variant="outline">{doc.scope}</Badge>
        <Link href={`/admin/providers/${doc.provider.id}`} className="underline underline-offset-4">
          {doc.provider.displayName}
        </Link>
        {doc.vehicle ? (
          <Link href={`/admin/vehicles/${doc.vehicle.id}`} className="underline underline-offset-4">
            {doc.vehicle.title} ({doc.vehicle.status})
          </Link>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        Uploaded {formatDateTime(doc.createdAt)} · {doc.mimeType} ·{' '}
        {Math.round(doc.sizeBytes / 1024)} KB
        {doc.documentNumber ? ` · no. ${doc.documentNumber}` : ''}
        {doc.issuedOn ? ` · issued ${formatDay(doc.issuedOn)}` : ''} · expiry: {expiry}
        {doc.reviewedAt ? ` · reviewed ${formatDateTime(doc.reviewedAt)}` : ''}
      </p>
      {doc.reviewReason ? (
        <p className="text-xs">
          <span className="text-muted-foreground">Message to the provider:</span> {doc.reviewReason}
        </p>
      ) : null}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={viewing}
          onClick={async () => {
            setViewing(true);
            setError(null);
            try {
              openBlobInNewTab(await withAccessToken((t) => api.admin.documentContent(t, doc.id)));
            } catch (caught) {
              setError(submitErrorFrom(caught).message);
            } finally {
              setViewing(false);
            }
          }}
        >
          {viewing ? 'Opening…' : 'View'}
        </Button>
        {canDecide ? (
          <>
            <Button size="sm" variant="default" onClick={() => setApproving((v) => !v)}>
              Approve
            </Button>
            <ReasonAction
              label="Reject"
              confirmLabel="Reject document"
              variant="destructive"
              placeholder="Reason shown to the provider (5–500 characters)"
              onConfirm={async (reason) =>
                onChanged(
                  await withAccessToken((t) => api.admin.rejectDocument(t, doc.id, { reason })),
                )
              }
            />
          </>
        ) : null}
        {doc.effectiveStatus === 'approved' ? (
          <ReasonAction
            label="Request replacement"
            confirmLabel="Ask for a new upload"
            variant="outline"
            placeholder="What must the provider upload instead? (shown to the provider)"
            onConfirm={async (reason) =>
              onChanged(
                await withAccessToken((t) =>
                  api.admin.requestDocumentReplacement(t, doc.id, { reason }),
                ),
              )
            }
          />
        ) : null}
      </div>
      {approving ? (
        <ApproveForm
          doc={doc}
          onDone={(updated) => {
            setApproving(false);
            onChanged(updated);
          }}
          onCancel={() => setApproving(false)}
        />
      ) : null}
    </li>
  );
}

function ApproveForm({
  doc,
  onDone,
  onCancel,
}: {
  doc: AdminDocument;
  onDone: (doc: AdminDocument) => void;
  onCancel: () => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const [expiresOn, setExpiresOn] = useState(doc.expiresOn ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 rounded-md border p-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onDone(
            await withAccessToken((t) =>
              api.admin.approveDocument(t, doc.id, {
                expiresOn: expiresOn ? expiresOn : null,
                ...(note.trim() ? { note: note.trim() } : {}),
              }),
            ),
          );
        } catch (caught) {
          setError(submitErrorFrom(caught).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id={`expires-${doc.id}`}
          label="Expiry date as printed (optional)"
          hint="Leave empty for documents without an expiry. Drives reminders and the auto-pause."
        >
          <Input
            id={`expires-${doc.id}`}
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </FormField>
        <FormField id={`note-${doc.id}`} label="Internal note (optional)">
          <Textarea
            id={`note-${doc.id}`}
            className="min-h-9"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Approving…' : 'Approve document'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
