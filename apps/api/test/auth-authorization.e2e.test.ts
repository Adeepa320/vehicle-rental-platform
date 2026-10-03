import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { runMigrations, users, type DatabaseHandle } from '@vrp/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types';
import { CurrentUser } from '../src/modules/auth/decorators/current-user.decorator';
import { Roles } from '../src/modules/auth/decorators/roles.decorator';
import { cleanupUsers, emailFactory, login, registerAndVerify } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping authorization e2e tests');

const SCOPE = 'authz';
const nextEmail = emailFactory(SCOPE);

/** Test-only routes exercising the guards; no admin features exist in Phase 2. */
@Controller('authz-fixture')
class AuthzFixtureController {
  @Get('any-user')
  anyUser(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, roles: user.roles };
  }

  @Get('admin-only')
  @Roles('admin', 'super_admin')
  adminOnly() {
    return { ok: true };
  }
}

describe.skipIf(!url)('authentication and role guards', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({
      env: { DATABASE_URL: url as string },
      controllers: [AuthzFixtureController],
    });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('protects routes by default', async () => {
    const missing = await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    expect(missing.body.error.code).toBe('UNAUTHENTICATED');
    await request(app.getHttpServer())
      .get('/api/v1/authz-fixture/any-user')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Basic abc')
      .expect(401);
  });

  it('keeps health and readiness public', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('lets an authenticated customer through and exposes the user to handlers', async () => {
    const email = nextEmail();
    const { user } = await registerAndVerify(app, email);
    const session = await login(app, email);
    const response = await request(app.getHttpServer())
      .get('/api/v1/authz-fixture/any-user')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(200);
    expect(response.body).toEqual({ id: user.id, roles: ['customer'] });
  });

  it('forbids customers from admin-only routes and grants roles only from the database', async () => {
    const email = nextEmail();
    const { user } = await registerAndVerify(app, email);
    const session = await login(app, email);

    const forbidden = await request(app.getHttpServer())
      .get('/api/v1/authz-fixture/admin-only')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    // Promote via the database (the only path that exists until admin tooling arrives) and
    // the same access token now passes: roles are read from the row, not the token.
    await handle.db
      .update(users)
      .set({ roles: ['customer', 'admin'] })
      .where(eq(users.id, user.id));
    await request(app.getHttpServer())
      .get('/api/v1/authz-fixture/admin-only')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(200);
  });

  it('prevents a customer from escalating their own role through any public endpoint', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const session = await login(app, email);

    const patch = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .send({ roles: ['admin'] })
      .expect(400);
    expect(patch.body.error.code).toBe('VALIDATION_ERROR');

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(200);
    expect(me.body.roles).toEqual(['customer']);
    expect(me.body.status).toBe('active');

    // Status is equally client-immutable.
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .send({ status: 'suspended', emailVerified: false })
      .expect(400);
  });
});
