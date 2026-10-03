import { z } from 'zod';

/** `GET /api/v1/health` — liveness. Never touches the database. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  environment: z.enum(['development', 'test', 'production']),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadinessCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative().optional(),
  /** Present when `status` is `down`. Never contains connection strings or secrets. */
  message: z.string().optional(),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

/**
 * `GET /api/v1/ready` — readiness. HTTP 200 when every check is `up`,
 * HTTP 503 (same body shape) otherwise.
 */
export const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: ReadinessCheckSchema,
    postgis: ReadinessCheckSchema,
    migrations: ReadinessCheckSchema,
  }),
  timestamp: z.iso.datetime(),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
