import type { VehicleEditability, VehicleStatus } from '@vrp/contracts';

/**
 * Vehicle listing state machine (TECH_DECISIONS D38): one enum for review and
 * listing lifecycle.
 *
 *   draft ──submit──▶ submitted ──start_review──▶ under_review
 *     ▲                  ├── request_changes ──▶ changes_requested ──submit──▶ submitted
 *     │                  ├── approve ─────────▶ approved ◀──activate──── inactive
 *     │                  └── reject ──────────▶ rejected (terminal)       ▲ (provider)
 *                     approved ──deactivate (provider)────────────────────┘
 *                     approved | inactive ──suspend (admin)──▶ suspended ──reactivate (admin)──▶ approved
 *
 * Providers edit everything in `draft` / `changes_requested`, and only
 * operational fields (title, description, pricing, rules, location) once
 * approved. Only `approved` vehicles can ever be available; manual blocks may
 * be managed while `approved` or `inactive`.
 */
export type ProviderVehicleAction = 'submit' | 'deactivate' | 'activate';
export type AdminVehicleAction =
  'start_review' | 'request_changes' | 'approve' | 'reject' | 'suspend' | 'reactivate';

interface Transition {
  from: readonly VehicleStatus[];
  to: VehicleStatus;
}

export const PROVIDER_VEHICLE_TRANSITIONS: Readonly<Record<ProviderVehicleAction, Transition>> = {
  submit: { from: ['draft', 'changes_requested'], to: 'submitted' },
  deactivate: { from: ['approved'], to: 'inactive' },
  activate: { from: ['inactive'], to: 'approved' },
};

export const ADMIN_VEHICLE_TRANSITIONS: Readonly<Record<AdminVehicleAction, Transition>> = {
  start_review: { from: ['submitted'], to: 'under_review' },
  request_changes: { from: ['submitted', 'under_review'], to: 'changes_requested' },
  approve: { from: ['submitted', 'under_review'], to: 'approved' },
  reject: { from: ['submitted', 'under_review'], to: 'rejected' },
  suspend: { from: ['approved', 'inactive'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'approved' },
};

/** Statuses in which a provider may manage availability blocks. */
export const BLOCKABLE_STATUSES: readonly VehicleStatus[] = ['approved', 'inactive'];

export function editability(status: VehicleStatus): VehicleEditability {
  if (status === 'draft' || status === 'changes_requested') return 'all';
  if (status === 'approved' || status === 'inactive') return 'operational';
  return 'none';
}

export function canSubmit(status: VehicleStatus): boolean {
  return PROVIDER_VEHICLE_TRANSITIONS.submit.from.includes(status);
}

export function canProvider(action: ProviderVehicleAction, from: VehicleStatus): boolean {
  return PROVIDER_VEHICLE_TRANSITIONS[action].from.includes(from);
}

export function canAdmin(action: AdminVehicleAction, from: VehicleStatus): boolean {
  return ADMIN_VEHICLE_TRANSITIONS[action].from.includes(from);
}

/** Only approved vehicles are ever bookable; blocks then subtract from that. */
export function isBookable(status: VehicleStatus): boolean {
  return status === 'approved';
}

export function isTerminal(status: VehicleStatus): boolean {
  return status === 'rejected';
}
