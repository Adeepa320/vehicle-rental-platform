import type { AdminPrivacyRequest, AnonymisationBlocker, PrivacyRequest } from '@vrp/contracts';
import type { PrivacyRequestRow } from '@vrp/database';

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

/** What the requester sees: never the requester note echo, the internal note, the handler or the source. */
export function toPrivacyRequestView(
  row: PrivacyRequestRow,
  blockers: AnonymisationBlocker[],
): PrivacyRequest {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    acknowledgedAt: iso(row.acknowledgedAt),
    completedAt: iso(row.completedAt),
    rejectedAt: iso(row.rejectedAt),
    publicNote: row.publicNote,
    blockers,
  };
}

export interface AdminPrivacyRequestContext {
  user: { id: string; email: string; fullName: string; status: string; roles: string[] };
  handledBy: { id: string; email: string } | null;
  blockers: AnonymisationBlocker[];
}

export function toAdminPrivacyRequestView(
  row: PrivacyRequestRow,
  context: AdminPrivacyRequestContext,
): AdminPrivacyRequest {
  return {
    ...toPrivacyRequestView(row, context.blockers),
    source: row.source === 'admin' ? 'admin' : 'self',
    requesterNote: row.requesterNote,
    internalNote: row.internalNote,
    user: {
      id: context.user.id,
      email: context.user.email,
      fullName: context.user.fullName,
      status: context.user.status as AdminPrivacyRequest['user']['status'],
      roles: context.user.roles,
    },
    handledBy: context.handledBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}
