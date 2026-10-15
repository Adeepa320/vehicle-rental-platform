'use client';

import {
  COUPLED_MONEY_SETTING_KEYS,
  SETTING_DEFINITIONS,
  SettingGroupSchema,
  type AdminSetting,
  type AdminSettingsResponse,
  type SettingChange,
  type SettingKey,
} from '@vrp/contracts';
import { useEffect, useState } from 'react';

import { AdminShell, selectClass } from '@/components/admin/admin-shell';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SETTING_GROUP_LABEL, compactJson } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

type EditorKind = 'number' | 'boolean' | 'enum' | 'json';

/** How each key is edited; the contract schema still validates the parsed value. */
function editorKind(key: SettingKey): EditorKind {
  if (key === 'contact_reveal_stage') return 'enum';
  if (key === 'auto_pause_on_document_expiry') return 'boolean';
  if (key === 'indicative_exchange_rates') return 'json';
  return 'number';
}

/** Text shown in the editor for the stored value. */
function toDraft(setting: AdminSetting): string {
  const kind = editorKind(setting.key);
  if (kind === 'json') return JSON.stringify(setting.value, null, 2);
  if (kind === 'boolean') return setting.value === true ? 'true' : 'false';
  return setting.value === null || setting.value === undefined ? '' : String(setting.value);
}

/** Parses the editor text back into the typed value, or an error message. */
function fromDraft(key: SettingKey, draft: string): { value: unknown } | { error: string } {
  const kind = editorKind(key);
  let value: unknown;
  if (kind === 'number') {
    if (draft.trim() === '') return { error: 'Enter a number' };
    value = Number(draft);
    if (!Number.isFinite(value)) return { error: 'Enter a number' };
  } else if (kind === 'boolean') {
    value = draft === 'true';
  } else if (kind === 'json') {
    try {
      value = JSON.parse(draft) as unknown;
    } catch {
      return { error: 'Invalid JSON' };
    }
  } else {
    value = draft;
  }
  const parsed = SETTING_DEFINITIONS[key].schema.safeParse(value);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid value' };
  return { value: parsed.data };
}

export default function AdminSettingsPage() {
  const area = useAdminArea();
  const { api, ready, isSuperAdmin, withAccessToken } = area;
  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SettingKey, string>>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.getSettings(t))
      .then((result) => {
        if (!cancelled) setSettings(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, ready, withAccessToken]);

  const byKey = new Map<SettingKey, AdminSetting>(settings?.data.map((s) => [s.key, s]) ?? []);
  const changedKeys = (Object.keys(drafts) as SettingKey[]).filter((key) => {
    const setting = byKey.get(key);
    return setting !== undefined && drafts[key] !== undefined && drafts[key] !== toDraft(setting);
  });
  const needsReason = changedKeys.some((key) => SETTING_DEFINITIONS[key].highImpact);
  const canSave =
    isSuperAdmin && changedKeys.length > 0 && !busy && (!needsReason || reason.trim().length >= 5);

  async function save() {
    if (!settings) return;
    const changes: SettingChange[] = [];
    const errors: Partial<Record<SettingKey, string>> = {};
    for (const key of changedKeys) {
      const setting = byKey.get(key);
      const draft = drafts[key];
      if (!setting || draft === undefined) continue;
      const parsed = fromDraft(key, draft);
      if ('error' in parsed) errors[key] = parsed.error;
      else changes.push({ key, value: parsed.value, expectedUpdatedAt: setting.updatedAt });
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || changes.length === 0) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const next = await withAccessToken((t) =>
        api.admin.updateSettings(t, {
          changes,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      );
      setSettings(next);
      setDrafts({});
      setReason('');
      setSaved(`Saved ${changes.length} setting${changes.length === 1 ? '' : 's'}.`);
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setError(
        failure.code === 'SETTING_STALE'
          ? `${failure.message} Reload the page to see the current values before saving again.`
          : failure.code === 'SETTING_MONEY_MODEL_UNSUPPORTED'
            ? `${failure.message} The online advance must equal the platform commission while no settlement ledger exists.`
            : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell area={area} width="max-w-4xl">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Platform settings</h1>
        <p className="text-muted-foreground text-sm">
          Typed operator settings. Changes apply to new decisions only; existing bookings keep the
          values snapshotted when they were requested. Every change is audited with its reason.
        </p>
        {!isSuperAdmin ? (
          <FormMessage title="Super admin only">
            You can read these settings but not change them; editing is restricted to super admins.
          </FormMessage>
        ) : null}
      </header>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {saved ? <FormMessage>{saved}</FormMessage> : null}
      {!settings ? (
        <p className="text-muted-foreground text-sm">Loading settings…</p>
      ) : (
        <>
          {SettingGroupSchema.options.map((group) => {
            const rows = settings.data.filter((s) => s.group === group);
            if (rows.length === 0) return null;
            return (
              <AuthCard
                key={group}
                title={SETTING_GROUP_LABEL[group]}
                description={
                  group === 'money'
                    ? `Coupled pair: ${COUPLED_MONEY_SETTING_KEYS.join(' and ')} must stay equal (money model B: the online advance is the platform commission, so the platform never holds provider money). Change both together.`
                    : undefined
                }
              >
                <div className="grid gap-4">
                  {rows.map((setting) => (
                    <SettingRow
                      key={setting.key}
                      setting={setting}
                      draft={drafts[setting.key] ?? toDraft(setting)}
                      changed={changedKeys.includes(setting.key)}
                      error={fieldErrors[setting.key]}
                      disabled={!isSuperAdmin || busy}
                      onChange={(value) => setDrafts((d) => ({ ...d, [setting.key]: value }))}
                    />
                  ))}
                </div>
              </AuthCard>
            );
          })}

          <AuthCard
            title="Save changes"
            description={
              changedKeys.length === 0
                ? 'Nothing changed yet.'
                : `${changedKeys.length} changed: ${changedKeys.map((k) => SETTING_DEFINITIONS[k].label).join(', ')}.`
            }
          >
            <div className="grid gap-3">
              {needsReason ? (
                <FormMessage variant="destructive" title="High-impact change">
                  At least one changed setting affects live booking, payment or cancellation
                  behaviour. A reason (5–500 characters) is required and recorded in the audit log.
                </FormMessage>
              ) : null}
              <Textarea
                className="min-h-16"
                placeholder={needsReason ? 'Reason (required)' : 'Reason (optional)'}
                value={reason}
                disabled={!isSuperAdmin || busy}
                onChange={(e) => setReason(e.target.value)}
              />
              <div>
                <Button disabled={!canSave} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save changed settings'}
                </Button>
              </div>
            </div>
          </AuthCard>

          {settings.readOnly.length > 0 ? (
            <AuthCard
              title="Read-only settings"
              description="Shown for context; these are not editable through the console."
            >
              <dl className="grid gap-2 text-sm sm:grid-cols-[260px_1fr]">
                {settings.readOnly.map((row) => (
                  <div key={row.key} className="contents">
                    <dt className="text-muted-foreground">
                      {row.key}
                      {row.description ? (
                        <span className="block text-xs">{row.description}</span>
                      ) : null}
                    </dt>
                    <dd className="font-mono text-xs break-all">{compactJson(row.value)}</dd>
                  </div>
                ))}
              </dl>
            </AuthCard>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}

function SettingRow({
  setting,
  draft,
  changed,
  error,
  disabled,
  onChange,
}: {
  setting: AdminSetting;
  draft: string;
  changed: boolean;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const kind = editorKind(setting.key);
  const id = `setting-${setting.key}`;
  return (
    <div className={`grid gap-1.5 rounded-md border p-3 ${changed ? 'border-primary' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {setting.label}
        </label>
        {setting.highImpact ? <Badge variant="destructive">High impact</Badge> : null}
        {changed ? <Badge variant="outline">Changed</Badge> : null}
      </div>
      <p className="text-muted-foreground text-xs">{setting.description}</p>
      {kind === 'json' ? (
        <Textarea
          id={id}
          className="min-h-28 font-mono text-xs"
          value={draft}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : kind === 'boolean' ? (
        <select
          id={id}
          className={selectClass}
          value={draft}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="true">On</option>
          <option value="false">Off</option>
        </select>
      ) : kind === 'enum' ? (
        <select
          id={id}
          className={selectClass}
          value={draft}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="accepted">accepted</option>
          <option value="confirmed">confirmed</option>
        </select>
      ) : (
        <Input
          id={id}
          type="number"
          step="any"
          className="w-48"
          value={draft}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Accepts: {setting.hint} · last changed {formatDateTime(setting.updatedAt)}
        </p>
      )}
    </div>
  );
}
