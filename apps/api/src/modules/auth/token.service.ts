import { randomUUID } from 'node:crypto';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRoleSchema } from '@vrp/contracts';
import {
  SignJWT,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type CryptoKey,
  type KeyObject,
} from 'jose';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import type { Env } from '../../config/env.schema';

const ALGORITHM = 'EdDSA';

const accessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  roles: z.array(UserRoleSchema),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

type Key = CryptoKey | KeyObject;

/** Issues and verifies short-lived access tokens (JWT, Ed25519 / EdDSA). */
@Injectable()
export class TokenService implements OnModuleInit {
  private privateKey!: Key;
  private publicKey!: Key;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly ttlSeconds: number;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TokenService.name);
    this.issuer = config.get('JWT_ISSUER', { infer: true });
    this.audience = config.get('JWT_AUDIENCE', { infer: true });
    this.ttlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    const privatePem = this.config.get('JWT_PRIVATE_KEY', { infer: true });
    const publicPem = this.config.get('JWT_PUBLIC_KEY', { infer: true });
    if (privatePem && publicPem) {
      this.privateKey = await importPKCS8(unescapePem(privatePem), ALGORITHM);
      this.publicKey = await importSPKI(unescapePem(publicPem), ALGORITHM);
      return;
    }
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be configured in production');
    }
    const pair = await generateKeyPair(ALGORITHM);
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.logger.warn(
      'JWT_PRIVATE_KEY / JWT_PUBLIC_KEY not set: using an ephemeral Ed25519 key pair; access tokens will not survive a restart (run `pnpm --filter @vrp/api keys:generate`)',
    );
  }

  get accessTokenTtlSeconds(): number {
    return this.ttlSeconds;
  }

  async signAccessToken(user: {
    id: string;
    roles: string[];
    sessionId: string;
  }): Promise<{ token: string; expiresIn: number }> {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ roles: user.roles, sid: user.sessionId })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.ttlSeconds)
      .setJti(randomUUID())
      .sign(this.privateKey);
    return { token, expiresIn: this.ttlSeconds };
  }

  /** Throws on any signature, expiry, issuer, audience or shape problem. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: [ALGORITHM],
    });
    return accessTokenClaimsSchema.parse(payload);
  }
}

/** Environment files often carry PEMs on one line with literal `\n`. */
function unescapePem(pem: string): string {
  return pem.includes('\\n') ? pem.replaceAll('\\n', '\n') : pem;
}
