import fs from 'node:fs';
import path from 'node:path';

import { E2E_DIR } from './env';

export interface Account {
  email: string;
  password: string;
  fullName: string;
  userId: string;
  accessToken: string;
}

export interface AdminAccount extends Account {
  role: 'admin' | 'super_admin';
  /** Base32 authenticator secret when the account is enrolled. */
  totpSecret: string | null;
}

export interface ProviderAccount extends Account {
  providerId: string;
  displayName: string;
  contactName: string;
  phone: string;
  locationId: string;
}

/** Created once per run by the `setup` project and shared by every spec file. */
export interface World {
  runId: string;
  createdAt: string;
  /** Super admin with a verified factor; its token approves applications and listings from the fixtures. */
  admin: AdminAccount;
  provider: ProviderAccount;
  places: { mirissaId: string };
}

export const WORLD_FILE = path.join(E2E_DIR, '.world', 'world.json');

export function saveWorld(world: World): void {
  fs.mkdirSync(path.dirname(WORLD_FILE), { recursive: true });
  fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
}

export function loadWorld(): World {
  if (!fs.existsSync(WORLD_FILE)) {
    throw new Error(
      `${WORLD_FILE} is missing: the "setup" project must run first (pnpm e2e runs it)`,
    );
  }
  return JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8')) as World;
}
