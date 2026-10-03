import type { ProviderApplicationStatus } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_TRANSITIONS,
  APPLICANT_TRANSITIONS,
  canAdmin,
  canApplicant,
  isEditable,
  isTerminal,
} from './provider-application.state';

const ALL: ProviderApplicationStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
];

describe('provider application state machine', () => {
  it('lets applicants submit only from draft or changes_requested', () => {
    expect(ALL.filter((s) => canApplicant('submit', s))).toEqual(['draft', 'changes_requested']);
  });

  it('lets admins act only on submitted/under_review applications', () => {
    expect(ALL.filter((s) => canAdmin('start_review', s))).toEqual(['submitted']);
    for (const action of ['request_changes', 'approve', 'reject'] as const) {
      expect(ALL.filter((s) => canAdmin(action, s))).toEqual(['submitted', 'under_review']);
    }
  });

  it('never allows transitions out of terminal states', () => {
    for (const status of ['approved', 'rejected'] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(canApplicant('submit', status)).toBe(false);
      for (const action of Object.keys(ADMIN_TRANSITIONS) as (keyof typeof ADMIN_TRANSITIONS)[]) {
        expect(canAdmin(action, status)).toBe(false);
      }
    }
  });

  it('allows edits only while the applicant owns the next step', () => {
    expect(ALL.filter(isEditable)).toEqual(['draft', 'changes_requested']);
  });

  it('declares every target state', () => {
    for (const t of [
      ...Object.values(APPLICANT_TRANSITIONS),
      ...Object.values(ADMIN_TRANSITIONS),
    ]) {
      expect(ALL).toContain(t.to);
      expect(t.from.length).toBeGreaterThan(0);
    }
  });
});
