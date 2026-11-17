/**
 * closeZone's order and its failure discipline, with the instance's close and the ports' withdrawal
 * standing in as recorders (the instance's close is proven in host/__tests__, the withdrawal in
 * server-and-relay-ports.test.ts): a refused withdrawal is reported on a live page and is not on a
 * page that is going away.
 */
import { describe, expect, it } from 'vitest';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { closeZone, type ZoneAudit, type ZoneParts } from '../zone-close';

function parts(steps: string[], withdrawn: AppsResult<number> | null, leaving: boolean): ZoneParts {
  return {
    ids: { appId: 'com.acme.kanban', installId: 'i1', zoneId: 'board' },
    instance: null,
    bound: {
      ports: {},
      held: new Set(),
      withdraw: async (): Promise<AppsResult<number> | null> => { steps.push('withdraw'); return withdrawn; },
      // Settles a turn later, as the agent's answers to the leaves do: the audit waits for it.
      stop: async (): Promise<void> => { await Promise.resolve(); steps.push('drop ports'); },
    },
    quiesce: (): void => { steps.push('quiesce'); },
    disposeSurface: (): void => { steps.push('canvas'); },
    leaving: (): boolean => leaving,
  };
}

describe('closing a zone', () => {
  it('quiesces, withdraws, removes the canvas, drops the ports, then audits, in that order', async () => {
    const steps: string[] = [];
    const audits: ZoneAudit[] = [];
    await closeZone(parts(steps, { ok: true, value: 2 }, false), 'uninstall', { audit: (a) => { steps.push('audit'); audits.push(a); }, report: () => steps.push('report') });
    expect(steps).toEqual(['quiesce', 'withdraw', 'canvas', 'drop ports', 'audit']);
    expect(audits).toMatchObject([{ reason: 'uninstall', ending: 'not-started', withdrawal: { ended: 2 } }]);
  });

  it('a refused withdrawal is reported on a live page (control: not on a page going away)', async () => {
    const live: string[] = [];
    await closeZone(parts([], { ok: false, refusal: 'NoAnswer' }, false), 'unmount', { audit: () => undefined, report: (what) => live.push(what) });
    expect(live).toHaveLength(1);
    const leaving: string[] = [];
    await closeZone(parts([], { ok: false, refusal: 'NoAnswer' }, true), 'host_shutdown', { audit: () => undefined, report: (what) => leaving.push(what) });
    expect(leaving).toEqual([]);
  });
});
