import { spawnSync } from 'node:child_process';

import type {
  AuthSessionResponse,
  LoginResponse,
  MfaEnrolConfirmResponse,
  MfaEnrolStartResponse,
  RegisterResponse,
} from '@vrp/contracts';

import { call } from './api';
import { REPO_ROOT } from './env';
import { extractToken, waitForEmail } from './mailpit';
import { freshTotpCode } from './totp';
import type { Account, AdminAccount } from './world';

/** One password for every account the suite creates (meets the 10-character policy, not a common password). */
export const PASSWORD = 'E2E-browser-suite-2026!';

/** Short per-process run id; e-mail addresses embed it so runs never collide. */
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let counter = 0;
export function uniqueEmail(label: string): string {
  counter += 1;
  return `e2e-${RUN_ID}-${label}-${counter}@example.com`;
}

export function isMfaRequired(
  response: LoginResponse,
): response is Extract<LoginResponse, { mfaRequired: true }> {
  return 'mfaRequired' in response && response.mfaRequired === true;
}

/** `POST /auth/login` as a mobile client: tokens in the body, no cookies to manage. */
export async function loginApi(email: string, password = PASSWORD): Promise<LoginResponse> {
  const { body } = await call<LoginResponse>('POST', '/auth/login', {
    body: { email, password, client: 'mobile' },
  });
  return body;
}

/** Registers, verifies through the Mailpit link and logs in. */
export async function registerVerifiedUser(label: string, fullName: string): Promise<Account> {
  const email = uniqueEmail(label);
  const registered = await call<RegisterResponse>('POST', '/auth/register', {
    body: { fullName, email, password: PASSWORD, acceptTerms: true },
    expect: 201,
  });
  const mail = await waitForEmail(email, 'Verify');
  await call('POST', '/auth/email/verify', { body: { token: extractToken(mail.Text) } });
  const session = await loginApi(email);
  if (isMfaRequired(session)) throw new Error(`fresh account ${email} unexpectedly needs MFA`);
  return {
    email,
    password: PASSWORD,
    fullName,
    userId: registered.body.user.id,
    accessToken: session.accessToken,
  };
}

/** `pnpm admin:grant --email … --role …` from the repo root (the only way to create administrators). */
export function grantAdminRole(email: string, role: 'admin' | 'super_admin'): void {
  // One command string: Node 24 warns (DEP0190) when an argument array is used with a shell.
  const result = spawnSync(`pnpm admin:grant --email ${email} --role ${role}`, {
    cwd: REPO_ROOT,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `pnpm admin:grant failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

/**
 * Enrols an authenticator for the account and returns the base32 secret plus
 * the upgraded (factor-verified) access token from the confirm response.
 */
export async function enrolTotp(
  account: Account,
): Promise<{ secret: string; accessToken: string; recoveryCodes: string[] }> {
  const start = await call<MfaEnrolStartResponse>('POST', '/auth/mfa/enrol/start', {
    token: account.accessToken,
    body: { password: account.password },
  });
  const confirm = await call<MfaEnrolConfirmResponse>('POST', '/auth/mfa/enrol/confirm', {
    token: account.accessToken,
    body: { code: await freshTotpCode(start.body.secret) },
  });
  return {
    secret: start.body.secret,
    accessToken: confirm.body.session.accessToken,
    recoveryCodes: confirm.body.recoveryCodes,
  };
}

export interface CreateAdminOptions {
  role: 'admin' | 'super_admin';
  /** Enrol an authenticator right away (needed for any privileged API call while ADMIN_MFA_REQUIRED=true). */
  enrol: boolean;
  fullName?: string;
}

/** Verified account → role granted through the CLI → optional authenticator enrolment. */
export async function createAdmin(
  label: string,
  options: CreateAdminOptions,
): Promise<AdminAccount> {
  const account = await registerVerifiedUser(label, options.fullName ?? `E2E ${label}`);
  grantAdminRole(account.email, options.role);
  if (!options.enrol) return { ...account, role: options.role, totpSecret: null };
  const enrolled = await enrolTotp(account);
  return {
    ...account,
    accessToken: enrolled.accessToken,
    role: options.role,
    totpSecret: enrolled.secret,
  };
}

/** Password login followed by the authenticator step; returns a factor-verified session. */
export async function loginAdminApi(admin: AdminAccount): Promise<AuthSessionResponse> {
  const first = await loginApi(admin.email, admin.password);
  if (!isMfaRequired(first)) return first;
  if (!admin.totpSecret) throw new Error(`${admin.email} needs a code but has no secret on file`);
  const { body } = await call<AuthSessionResponse>('POST', '/auth/mfa/challenge', {
    body: { challengeToken: first.challengeToken, code: await freshTotpCode(admin.totpSecret) },
  });
  return body;
}
