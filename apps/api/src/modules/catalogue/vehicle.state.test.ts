import { VehicleStatusSchema } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_VEHICLE_TRANSITIONS,
  BLOCKABLE_STATUSES,
  PROVIDER_VEHICLE_TRANSITIONS,
  canAdmin,
  canProvider,
  editability,
  isBookable,
} from './vehicle.state';

describe('vehicle state machine', () => {
  it('lets providers submit only drafts and corrected listings', () => {
    expect(canProvider('submit', 'draft')).toBe(true);
    expect(canProvider('submit', 'changes_requested')).toBe(true);
    for (const status of [
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'inactive',
      'suspended',
    ] as const) {
      expect(canProvider('submit', status), status).toBe(false);
    }
  });

  it('lets providers deactivate approved listings and reactivate inactive ones only', () => {
    expect(canProvider('deactivate', 'approved')).toBe(true);
    expect(canProvider('deactivate', 'suspended')).toBe(false);
    expect(canProvider('activate', 'inactive')).toBe(true);
    expect(canProvider('activate', 'suspended')).toBe(false);
    expect(canProvider('activate', 'rejected')).toBe(false);
  });

  it('lets admins decide only on submitted/under_review, suspend live listings and reactivate suspended ones', () => {
    for (const action of ['request_changes', 'approve', 'reject'] as const) {
      expect(canAdmin(action, 'submitted')).toBe(true);
      expect(canAdmin(action, 'under_review')).toBe(true);
      expect(canAdmin(action, 'draft')).toBe(false);
      expect(canAdmin(action, 'approved')).toBe(false);
    }
    expect(canAdmin('start_review', 'submitted')).toBe(true);
    expect(canAdmin('start_review', 'under_review')).toBe(false);
    expect(canAdmin('suspend', 'approved')).toBe(true);
    expect(canAdmin('suspend', 'inactive')).toBe(true);
    expect(canAdmin('suspend', 'draft')).toBe(false);
    expect(canAdmin('reactivate', 'suspended')).toBe(true);
    expect(canAdmin('reactivate', 'inactive')).toBe(false);
  });

  it('never allows transitions out of rejected', () => {
    for (const t of [
      ...Object.values(PROVIDER_VEHICLE_TRANSITIONS),
      ...Object.values(ADMIN_VEHICLE_TRANSITIONS),
    ]) {
      expect(t.from).not.toContain('rejected');
    }
  });

  it('exposes editability and bookability consistently', () => {
    expect(editability('draft')).toBe('all');
    expect(editability('changes_requested')).toBe('all');
    expect(editability('approved')).toBe('operational');
    expect(editability('inactive')).toBe('operational');
    for (const status of ['submitted', 'under_review', 'rejected', 'suspended'] as const) {
      expect(editability(status), status).toBe('none');
    }
    expect(VehicleStatusSchema.options.filter(isBookable)).toEqual(['approved']);
    expect(BLOCKABLE_STATUSES).toEqual(['approved', 'inactive']);
  });

  it('declares every target state', () => {
    const targets = [
      ...Object.values(PROVIDER_VEHICLE_TRANSITIONS),
      ...Object.values(ADMIN_VEHICLE_TRANSITIONS),
    ].map((t) => t.to);
    for (const target of targets) expect(VehicleStatusSchema.options).toContain(target);
  });
});
