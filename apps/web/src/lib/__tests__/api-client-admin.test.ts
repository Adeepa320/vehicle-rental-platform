import type {
  AdminDocument,
  AdminUserDetail,
  AdminUserSummary,
  CancellationPreview,
  Dispute,
} from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import { ApiClientError, createApiClient } from '../api-client';

const BASE = 'http://api.test/api/v1';
const ID = '0192f0a0-0000-7000-8000-000000000123';
const OTHER_ID = '0192f0a0-0000-7000-8000-000000000456';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeApi(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: BASE, fetchImpl }), calls };
}

/** Binary responses (documents, CSV exports). */
function fakeBinaryApi(status: number, bytes: Uint8Array<ArrayBuffer>, contentType: string) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(bytes, { status, headers: { 'content-type': contentType } });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: BASE, fetchImpl }), calls };
}

const callAt = (calls: Call[], index: number): Call => {
  const call = calls[index];
  if (!call) throw new Error(`expected a recorded call #${index}`);
  return call;
};
const headersOf = (call: Call) => call.init.headers as Record<string, string>;
const bodyOf = (call: Call): unknown => JSON.parse(String(call.init.body));

const userSummary: AdminUserSummary = {
  id: ID,
  email: 'nimal@example.com',
  fullName: 'Nimal Perera',
  roles: ['customer'],
  status: 'active',
  emailVerified: true,
  countryCode: 'LK',
  providerId: null,
  createdAt: '2026-10-01T04:30:00.000Z',
  lastLoginAt: '2026-10-13T10:00:00.000Z',
};

const userDetail: AdminUserDetail = {
  ...userSummary,
  phone: null,
  phoneVerified: false,
  preferredLanguage: 'en',
  suspendedAt: null,
  suspensionReason: null,
  deletedAt: null,
  provider: null,
  bookings: {
    asCustomer: { total: 2, open: 0, completed: 2 },
    asProvider: { total: 0, open: 0, completed: 0 },
  },
  reviews: 1,
  openDisputes: 0,
  anonymisation: { allowed: true, blockers: [] },
};

const dispute: Dispute = {
  id: OTHER_ID,
  bookingId: ID,
  bookingReference: 'SLR-7F3K2Q',
  bookingStatus: 'completed',
  vehicleTitle: 'Toyota Aqua 2018',
  openedBy: 'customer',
  openedByMe: true,
  reasonCode: 'vehicle_condition',
  description: 'The air conditioning did not work for the whole rental.',
  status: 'open',
  resolutionCode: null,
  publicResolutionNote: null,
  resolvedAt: null,
  messages: [],
  canMessage: true,
  createdAt: '2026-10-13T10:00:00.000Z',
  updatedAt: '2026-10-13T10:00:00.000Z',
};

const adminDocument: AdminDocument = {
  id: OTHER_ID,
  scope: 'vehicle',
  type: 'revenue_licence',
  vehicleId: ID,
  status: 'approved',
  effectiveStatus: 'approved',
  mimeType: 'application/pdf',
  sizeBytes: 120_000,
  documentNumber: 'RL-123',
  issuedOn: '2026-02-01',
  expiresOn: '2027-01-31',
  reviewReason: null,
  reviewedAt: '2026-10-13T10:00:00.000Z',
  replacementRequestedAt: null,
  supersededAt: null,
  createdAt: '2026-10-12T10:00:00.000Z',
  provider: { id: ID, displayName: 'Sunil Rentals', status: 'active' },
  vehicle: { id: ID, title: 'Toyota Aqua 2018', status: 'approved' },
  uploadedBy: ID,
  reviewedBy: OTHER_ID,
  daysUntilExpiry: 108,
};

describe('api client (admin console, Phase 9)', () => {
  it('serialises the user list filters and parses the page', async () => {
    const { api, calls } = fakeApi(200, { data: [userSummary], nextCursor: null });
    const page = await api.admin.listUsers('token-1', {
      q: 'nimal',
      status: 'active',
      role: 'customer',
      limit: 30,
    });
    expect(page.data[0]?.email).toBe('nimal@example.com');
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/admin/users?q=nimal&status=active&role=customer&limit=30`);
    expect(call.init.method).toBe('GET');
    expect(headersOf(call).authorization).toBe('Bearer token-1');
  });

  it('posts the anonymise request with the retyped e-mail and reason', async () => {
    const { api, calls } = fakeApi(200, {
      ...userDetail,
      status: 'deleted',
      deletedAt: '2026-10-15T10:00:00.000Z',
      anonymisation: { allowed: false, blockers: ['already_anonymised'] },
    });
    const result = await api.admin.anonymiseUser('t', ID, {
      reason: 'Deletion request #42',
      confirmEmail: 'nimal@example.com',
    });
    expect(result.status).toBe('deleted');
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/admin/users/${ID}/anonymise`);
    expect(call.init.method).toBe('POST');
    expect(bodyOf(call)).toEqual({
      reason: 'Deletion request #42',
      confirmEmail: 'nimal@example.com',
    });

    const blocked = fakeApi(409, {
      error: {
        code: 'ACCOUNT_ANONYMISATION_BLOCKED',
        message: 'The account has open activity',
        details: [{ issue: 'open_booking_as_customer' }],
      },
    });
    await expect(
      blocked.api.admin.anonymiseUser('t', ID, {
        reason: 'Request',
        confirmEmail: 'nimal@example.com',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'ACCOUNT_ANONYMISATION_BLOCKED',
      details: [{ issue: 'open_booking_as_customer' }],
    } satisfies Partial<ApiClientError>);
  });

  it('sends only the changed settings with their concurrency tokens', async () => {
    const { api, calls } = fakeApi(200, { data: [], readOnly: [] });
    await api.admin.updateSettings('t', {
      changes: [
        {
          key: 'provider_response_hours',
          value: 12,
          expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      reason: 'Providers asked for a shorter window',
    });
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/admin/settings`);
    expect(call.init.method).toBe('PUT');
    expect(bodyOf(call)).toEqual({
      changes: [
        {
          key: 'provider_response_hours',
          value: 12,
          expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      reason: 'Providers asked for a shorter window',
    });
  });

  it('reads the cancellation preview and posts the admin cancellation body', async () => {
    const preview: CancellationPreview = {
      actor: 'platform',
      allowed: true,
      reason: null,
      resultingStatus: 'cancelled_by_platform',
      holdWillBeReleased: true,
      advancePaid: true,
      advanceAmount: '2250.00',
      refundDueAmount: '2250.00',
      forfeited: false,
      hoursBeforePickup: 72,
      fullRefundHours: 48,
    };
    const { api, calls } = fakeApi(200, preview);
    const result = await api.admin.cancellationPreview('t', ID, 'platform');
    expect(result.resultingStatus).toBe('cancelled_by_platform');
    expect(callAt(calls, 0).url).toBe(
      `${BASE}/admin/bookings/${ID}/cancellation-preview?actor=platform`,
    );

    // A stale version is refused; the body must still carry actor, reason and version only.
    const stale = fakeApi(409, {
      error: { code: 'STALE_VERSION', message: 'The booking changed; reload and try again' },
    });
    await expect(
      stale.api.admin.cancelBooking('t', ID, {
        actor: 'platform',
        reason: 'Vehicle written off',
        version: 2,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'STALE_VERSION' });
    const call = callAt(stale.calls, 0);
    expect(call.url).toBe(`${BASE}/admin/bookings/${ID}/cancel`);
    expect(call.init.method).toBe('POST');
    expect(bodyOf(call)).toEqual({ actor: 'platform', reason: 'Vehicle written off', version: 2 });
  });

  it('opens a dispute on the booking route and validates the response shape', async () => {
    const { api, calls } = fakeApi(201, dispute);
    const opened = await api.disputes.open('t', ID, {
      reasonCode: 'vehicle_condition',
      description: 'The air conditioning did not work for the whole rental.',
    });
    expect(opened.canMessage).toBe(true);
    expect(opened.openedByMe).toBe(true);
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/bookings/${ID}/dispute`);
    expect(call.init.method).toBe('POST');
    expect(bodyOf(call)).toEqual({
      reasonCode: 'vehicle_condition',
      description: 'The air conditioning did not work for the whole rental.',
    });

    const state = fakeApi(200, {
      eligible: false,
      reason: 'already_exists',
      windowClosesAt: null,
      dispute,
    });
    expect((await state.api.disputes.bookingState('t', ID)).dispute?.id).toBe(OTHER_ID);

    const { messages: _dropped, ...withoutThread } = dispute;
    const bad = fakeApi(200, withoutThread);
    await expect(bad.api.disputes.get('t', OTHER_ID)).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('approves a document with the printed expiry and an internal note', async () => {
    const { api, calls } = fakeApi(200, adminDocument);
    const approved = await api.admin.approveDocument('t', OTHER_ID, {
      expiresOn: '2027-01-31',
      note: 'Checked against the printed licence',
    });
    expect(approved.effectiveStatus).toBe('approved');
    expect(approved.daysUntilExpiry).toBe(108);
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/admin/documents/${OTHER_ID}/approve`);
    expect(call.init.method).toBe('POST');
    expect(bodyOf(call)).toEqual({
      expiresOn: '2027-01-31',
      note: 'Checked against the printed licence',
    });
  });

  it('fetches private binaries as Blobs with the bearer token', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const { api, calls } = fakeBinaryApi(200, pdf, 'application/pdf');
    const blob = await api.admin.documentContent('token-2', OTHER_ID);
    expect(blob.size).toBe(4);
    expect(blob.type).toBe('application/pdf');
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/admin/documents/${OTHER_ID}/content`);
    expect(headersOf(call).authorization).toBe('Bearer token-2');

    const csv = fakeBinaryApi(200, new TextEncoder().encode('a,b\n1,2\n'), 'text/csv');
    const report = await csv.api.admin.reportCsv('t', 'overview', {
      from: '2026-09-15',
      to: '2026-10-15',
    });
    expect(await report.text()).toBe('a,b\n1,2\n');
    expect(callAt(csv.calls, 0).url).toBe(
      `${BASE}/admin/reports/overview.csv?from=2026-09-15&to=2026-10-15`,
    );

    const missing = fakeApi(404, { error: { code: 'NOT_FOUND', message: 'No such document' } });
    await expect(missing.api.providerDocuments.content('t', OTHER_ID)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
