import type { HealthResponse, ReadyResponse } from '@vrp/contracts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createApiClient } from '@/lib/api-client';
import { serverEnv } from '@/lib/env';

// Status must reflect the API right now, never a cached render.
export const dynamic = 'force-dynamic';

type Probe<T> = { ok: true; data: T } | { ok: false; error: string };

async function probe<T>(run: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export default async function HomePage() {
  const env = serverEnv();
  const api = createApiClient({ baseUrl: env.API_INTERNAL_URL, timeoutMs: 3_000 });
  const [health, ready] = await Promise.all([
    probe<HealthResponse>(() => api.getHealth()),
    probe<ReadyResponse>(() => api.getReadiness()),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 1 · Foundation</p>
        <h1 className="text-3xl font-semibold tracking-tight">Vehicle Rental Platform</h1>
        <p className="text-muted-foreground">
          The web application is running. This page only reports the status of the local foundation;
          marketplace features arrive in later phases.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Web app</CardTitle>
            <CardDescription>Next.js App Router, Tailwind CSS, shadcn/ui</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge>Running</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API</CardTitle>
            <CardDescription>GET /health (liveness)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {health.ok ? (
              <>
                <Badge>{health.data.status}</Badge>
                <p className="text-muted-foreground text-sm">
                  {health.data.service} v{health.data.version} · {health.data.environment} · up{' '}
                  {health.data.uptimeSeconds}s
                </p>
              </>
            ) : (
              <>
                <Badge variant="destructive">Unreachable</Badge>
                <p className="text-muted-foreground text-sm">{health.error}</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle>Readiness</CardTitle>
            <CardDescription>GET /ready (database, PostGIS, migrations)</CardDescription>
          </CardHeader>
          <CardContent>
            {ready.ok ? (
              <ul className="grid gap-2 sm:grid-cols-3">
                {Object.entries(ready.data.checks).map(([name, check]) => (
                  <li key={name} className="flex flex-col gap-1 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium capitalize">{name}</span>
                      <Badge variant={check.status === 'up' ? 'default' : 'destructive'}>
                        {check.status}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {check.message ??
                        (check.latencyMs !== undefined ? `${check.latencyMs} ms` : '')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{ready.error}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <footer className="text-muted-foreground text-xs">
        API base URL (server-side): {env.API_INTERNAL_URL}
      </footer>
    </main>
  );
}
