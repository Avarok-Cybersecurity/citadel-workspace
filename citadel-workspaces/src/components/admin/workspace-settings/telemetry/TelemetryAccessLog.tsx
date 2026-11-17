import { useEffect, useState } from 'react';
import type { TelemetryAccessLogEntry } from 'citadel-workspace-client-ts';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { describeFailure } from '@/lib/failure-message';
import { formatDateTime } from '@/lib/format-time';

/** Who has read this workspace's diagnostic logs, newest first. `refreshKey` re-reads it. */
export function TelemetryAccessLog({ refreshKey }: { refreshKey: number }): JSX.Element {
  const [rows, setRows] = useState<TelemetryAccessLogEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect((): (() => void) => {
    let current: boolean = true;
    telemetryApi.accessLog()
      .then((log: TelemetryAccessLogEntry[]): void => { if (current) setRows(log); })
      .catch((error: unknown): void => { if (current) setProblem(describeFailure(error, 'The access log could not be read.')); });
    return (): void => { current = false; };
  }, [refreshKey]);

  if (problem) return <p role="alert" className="text-sm text-destructive-emphasis">{problem}</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nobody has read the logs yet.</p>;
  return (
    <ul className="space-y-1 text-xs max-h-48 overflow-y-auto" aria-label="Who read the logs" data-testid="telemetry-access-log">
      {rows.map((row: TelemetryAccessLogEntry, i: number): JSX.Element => (
        <li key={i} className="rounded bg-background/50 p-2">
          {formatDateTime(row.at_ms)} · {row.accessor === 'Support' ? 'Avarok support' : row.accessor.Member.user_id} · {row.returned} {row.returned === 1 ? 'line' : 'lines'}
        </li>
      ))}
    </ul>
  );
}
