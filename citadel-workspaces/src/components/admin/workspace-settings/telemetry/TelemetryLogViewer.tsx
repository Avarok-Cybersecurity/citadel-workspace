import { useState } from 'react';
import type { TelemetryFilter, TelemetryLevel, TelemetryPageResult, TelemetryRecord } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { describeFailure } from '@/lib/failure-message';
import { formatDateTime } from '@/lib/format-time';
import { EMPTY_FILTER_FORM, filterFromForm, type FilterForm, type FilterResult } from './telemetry-rules';
import { SELECT_CLASS } from './select-class';

/** How each level reads: a metric (a measurement such as a path report) is not a problem. */
const LEVEL_CLASS: Record<TelemetryLevel, string> = {
  Metric: 'text-muted-foreground',
  Warn: 'text-warning-emphasis',
  Error: 'text-destructive-emphasis',
};

/** Records per page: the server's page cap is larger. */
const PAGE_SIZE: number = 50;

/** Reads the workspace's diagnostic logs, newest first. Every read is recorded in the access log. */
export function TelemetryLogViewer({ onRead }: { onRead: () => void }): JSX.Element {
  const [form, setForm] = useState<FilterForm>(EMPTY_FILTER_FORM);
  const [shown, setShown] = useState<{ filter: TelemetryFilter; offset: number; result: TelemetryPageResult } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const set = <K extends keyof FilterForm>(key: K, value: FilterForm[K]): void => setForm((f: FilterForm) => ({ ...f, [key]: value }));

  const load = async (filter: TelemetryFilter, offset: number): Promise<void> => {
    setLoading(true);
    setProblem(null);
    try {
      setShown({ filter, offset, result: await telemetryApi.list(filter, { offset, limit: PAGE_SIZE }) });
      onRead();
    } catch (error: unknown) {
      setProblem(describeFailure(error, 'The logs could not be read.'));
    } finally {
      setLoading(false);
    }
  };

  const search = (): void => {
    const parsed: FilterResult = filterFromForm(form);
    if (!parsed.ok) { setProblem(parsed.problem); return; }
    void load(parsed.filter, 0);
  };

  return (
    <div className="space-y-3" data-testid="telemetry-log-viewer">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label htmlFor="tl-user">User</Label>
          <Input id="tl-user" value={form.user} onChange={(e) => set('user', e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="tl-peer">Peer CID</Label>
          <Input id="tl-peer" inputMode="numeric" value={form.peerCidText} onChange={(e) => set('peerCidText', e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="tl-level">Level</Label>
          <select id="tl-level" className={SELECT_CLASS} value={form.minLevel} onChange={(e) => set('minLevel', e.target.value as FilterForm['minLevel'])}>
            <option value="">Everything</option>
            <option value="Warn">Warnings and errors</option>
            <option value="Error">Errors only</option>
          </select></div>
        <div className="space-y-1"><Label htmlFor="tl-since">From</Label>
          <Input id="tl-since" type="datetime-local" value={form.since} onChange={(e) => set('since', e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="tl-until">Until</Label>
          <Input id="tl-until" type="datetime-local" value={form.until} onChange={(e) => set('until', e.target.value)} /></div>
      </div>
      <Button size="sm" onClick={search} disabled={loading}>{loading ? 'Reading…' : 'Show logs'}</Button>
      {problem && <p role="alert" className="text-sm text-destructive-emphasis">{problem}</p>}
      {shown !== null && (
        <>
          {shown.result.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">No logs match.</p>
          ) : (
            <ul className="space-y-1 text-xs font-mono max-h-72 overflow-y-auto" aria-label="Diagnostic logs">
              {shown.result.records.map((r: TelemetryRecord, i: number): JSX.Element => (
                <li key={`${shown.offset + i}`} className="break-words rounded bg-background/50 p-2">
                  <span className={LEVEL_CLASS[r.entry.level]}>{r.entry.level}</span>{' '}
                  {formatDateTime(r.entry.time_ms)} · {r.user_id}{r.entry.peer_cid !== null ? ` · peer ${r.entry.peer_cid.toString()}` : ''} · {r.os} · agent {r.agent_version}
                  <div>{r.entry.target}: {r.entry.message}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={loading || shown.offset === 0} onClick={(): void => { void load(shown.filter, Math.max(0, shown.offset - PAGE_SIZE)); }}>Newer</Button>
            <Button size="sm" variant="outline" disabled={loading || !shown.result.has_more} onClick={(): void => { void load(shown.filter, shown.offset + PAGE_SIZE); }}>Older</Button>
          </div>
        </>
      )}
    </div>
  );
}
