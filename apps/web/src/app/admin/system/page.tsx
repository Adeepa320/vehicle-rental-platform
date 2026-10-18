'use client';

import { useEffect, useState } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import type { WorkerStatus } from '@/lib/system/worker-status';

/** Background worker health: pg-boss schedules and queue counters, read on demand. */
export default function AdminSystemPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      withAccessToken((t) => api.admin.systemWorker(t))
        .then((result) => {
          if (!cancelled) setStatus(result);
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(submitErrorFrom(caught).message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, ready, reloadKey, withAccessToken]);

  return (
    <AdminShell area={area}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">System</h1>
          <p className="text-muted-foreground text-sm">
            Health of the background worker that sends e-mails, expires bookings, sweeps reminders
            and document expiry. Counts are read live from the job queue.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {!status ? (
        <p className="text-muted-foreground text-sm" role="status">
          {error ? '' : 'Loading worker status…'}
        </p>
      ) : (
        <>
          <AuthCard title="Worker">
            <div className="grid gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.healthy ? 'default' : 'destructive'}>
                  {status.healthy ? 'Healthy' : 'Attention needed'}
                </Badge>
                <span className="text-muted-foreground">
                  Checked {formatDateTime(status.checkedAt)} · considered stale after{' '}
                  {Math.round(status.staleAfterSeconds / 60)} minutes without a completed job
                </span>
              </div>
              {!status.healthy ? (
                <FormMessage variant="destructive" title="The worker looks stalled">
                  No job completed recently or recent jobs failed. Check that the worker process is
                  running (`pnpm dev:worker` locally) and read its logs before retrying anything.
                </FormMessage>
              ) : null}
            </div>
          </AuthCard>

          <AuthCard title="Schedules" description="Recurring jobs registered with the queue.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Scheduled jobs</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="p-2 font-medium">
                      Schedule
                    </th>
                    <th scope="col" className="p-2 font-medium">
                      Cron
                    </th>
                    <th scope="col" className="p-2 font-medium">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {status.schedules.map((schedule) => (
                    <tr key={schedule.name} className="border-t">
                      <td className="p-2 font-mono text-xs">{schedule.name}</td>
                      <td className="p-2 font-mono text-xs">{schedule.cron}</td>
                      <td className="p-2">{formatDateTime(schedule.updatedAt)}</td>
                    </tr>
                  ))}
                  {status.schedules.length === 0 ? (
                    <tr>
                      <td className="text-muted-foreground p-4 text-center" colSpan={3}>
                        No schedules registered — the worker has not started yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </AuthCard>

          <AuthCard title="Queues" description="Per-queue counters over the last 24 hours.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Queue counters</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="p-2 font-medium">
                      Queue
                    </th>
                    <th scope="col" className="p-2 text-right font-medium">
                      Queued
                    </th>
                    <th scope="col" className="p-2 text-right font-medium">
                      Active
                    </th>
                    <th scope="col" className="p-2 text-right font-medium">
                      Completed (24 h)
                    </th>
                    <th scope="col" className="p-2 text-right font-medium">
                      Failed (24 h)
                    </th>
                    <th scope="col" className="p-2 font-medium">
                      Last completed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {status.queues.map((queue) => (
                    <tr key={queue.name} className="border-t">
                      <td className="p-2 font-mono text-xs">{queue.name}</td>
                      <td className="p-2 text-right">{queue.queued}</td>
                      <td className="p-2 text-right">{queue.active}</td>
                      <td className="p-2 text-right">{queue.completedLast24h}</td>
                      <td
                        className={`p-2 text-right ${queue.failedLast24h > 0 ? 'text-destructive font-medium' : ''}`}
                      >
                        {queue.failedLast24h}
                      </td>
                      <td className="p-2">{formatDateTime(queue.lastCompletedAt)}</td>
                    </tr>
                  ))}
                  {status.queues.length === 0 ? (
                    <tr>
                      <td className="text-muted-foreground p-4 text-center" colSpan={6}>
                        No queues reported.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </AuthCard>
        </>
      )}
    </AdminShell>
  );
}
