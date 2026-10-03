import type { ProviderApplicationStatus } from '@vrp/contracts';

/**
 * Provider application state machine.
 *
 *   draft ──submit──▶ submitted ──start_review──▶ under_review
 *     ▲                  │                            │
 *     │                  ├── request_changes ─────────┤──▶ changes_requested ──submit──▶ submitted
 *     │                  ├── approve ─────────────────┤──▶ approved   (terminal; profile created)
 *     │                  └── reject ──────────────────┘──▶ rejected   (terminal in this phase)
 *
 * Applicants may edit only in `draft` and `changes_requested`. Suspension is a
 * provider-profile concern, not an application state.
 */
export type ApplicantAction = 'submit';
export type AdminAction = 'start_review' | 'request_changes' | 'approve' | 'reject';

interface Transition {
  from: readonly ProviderApplicationStatus[];
  to: ProviderApplicationStatus;
}

export const APPLICANT_TRANSITIONS: Readonly<Record<ApplicantAction, Transition>> = {
  submit: { from: ['draft', 'changes_requested'], to: 'submitted' },
};

export const ADMIN_TRANSITIONS: Readonly<Record<AdminAction, Transition>> = {
  start_review: { from: ['submitted'], to: 'under_review' },
  request_changes: { from: ['submitted', 'under_review'], to: 'changes_requested' },
  approve: { from: ['submitted', 'under_review'], to: 'approved' },
  reject: { from: ['submitted', 'under_review'], to: 'rejected' },
};

export const EDITABLE_STATUSES: readonly ProviderApplicationStatus[] = [
  'draft',
  'changes_requested',
];

export function isEditable(status: ProviderApplicationStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export function canApplicant(action: ApplicantAction, from: ProviderApplicationStatus): boolean {
  return APPLICANT_TRANSITIONS[action].from.includes(from);
}

export function canAdmin(action: AdminAction, from: ProviderApplicationStatus): boolean {
  return ADMIN_TRANSITIONS[action].from.includes(from);
}

export function isTerminal(status: ProviderApplicationStatus): boolean {
  return status === 'approved' || status === 'rejected';
}
