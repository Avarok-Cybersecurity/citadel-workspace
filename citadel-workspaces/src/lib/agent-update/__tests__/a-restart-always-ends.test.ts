/**
 * "Restart to update" always reaches an outcome, on an injected clock: the agent coming back as
 * the new version, or the deadline with the reason. The 0.11.0 shape is the first case: the
 * agent answers with no error (it handed the image to a menu-bar app that never took it), the
 * socket never drops, and the version never changes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { UpdateStatus } from 'citadel-internal-service-wasm-client';
import { restartPhase, restartToUpdate, type AgentNow, type RestartPorts } from '../restart-controller';
import { RESTART_DEADLINE_MS } from '../restart-flow';

/** Ports over a clock that moves only when told, and an agent the test speaks for. */
class Rig {
  clock: number = 1_000;
  timers: Array<{ at: number; run: () => void }> = [];
  agent: AgentNow = { current: '0.11.0', lastError: null };
  asked: string[] = [];
  apply: Promise<UpdateStatus> = Promise.resolve(this.status());
  private reconnects: Array<() => void> = [];
  private watchers: Array<(now: AgentNow) => void> = [];

  status(): UpdateStatus {
    return { cid: 0n, current: this.agent.current ?? '', available: null, auto_install: true, last_checked: null, last_error: this.agent.lastError, request_id: 'r' };
  }

  ports(): RestartPorts {
    return {
      now: (): number => this.clock,
      after: (ms: number, run: () => void): (() => void) => {
        const timer = { at: this.clock + ms, run };
        this.timers.push(timer);
        return (): void => { this.timers = this.timers.filter((t) => t !== timer); };
      },
      ask: (variant: 'UpdateApply' | 'UpdateGetStatus'): Promise<UpdateStatus> => {
        this.asked.push(variant);
        if (variant === 'UpdateApply') return this.apply;
        this.report(this.agent);
        return Promise.resolve(this.status());
      },
      onReconnect: (run: () => void): (() => void) => { this.reconnects.push(run); return (): void => undefined; },
      watchAgent: (run: (now: AgentNow) => void): (() => void) => {
        this.watchers.push(run);
        return (): void => { this.watchers = this.watchers.filter((w) => w !== run); };
      },
      agentNow: (): AgentNow => this.agent,
    };
  }

  advance(ms: number): void {
    this.clock += ms;
    for (const t of this.timers.filter((x) => x.at <= this.clock)) t.run();
  }

  /** The socket opened again, on an agent that now runs `current`. */
  reconnect(current: string): void {
    this.agent = { ...this.agent, current };
    this.reconnects.forEach((r) => r());
  }

  private report(now: AgentNow): void { this.watchers.forEach((w) => w(now)); }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { restartPhase.set({ kind: 'idle' }); });

describe('a restart to update', () => {
  it('that never comes back fails at the deadline, naming both versions', async () => {
    const rig = new Rig();
    restartToUpdate('0.13.0', '0.11.0', rig.ports());
    await settle();
    expect(restartPhase.get().kind).toBe('restarting');
    rig.advance(RESTART_DEADLINE_MS - 1);
    expect(restartPhase.get().kind).toBe('restarting');
    rig.advance(1);
    const phase = restartPhase.get();
    expect(phase).toMatchObject({ kind: 'failed', target: '0.13.0' });
    expect(phase.kind === 'failed' && phase.message).toMatch(/did not come back as 0\.13\.0 within 2 minutes, so it is still 0\.11\.0/);
    expect(rig.timers).toEqual([]);
  });

  it('that comes back as the new version is an update, before the deadline', async () => {
    const rig = new Rig();
    rig.apply = new Promise<UpdateStatus>((_, reject) => { reject(new Error('UpdateApply failed: the connection to the Citadel agent was lost')); });
    restartToUpdate('0.13.0', '0.11.0', rig.ports());
    await settle();
    expect(restartPhase.get().kind).toBe('restarting');
    rig.advance(30_000);
    rig.reconnect('0.13.0');
    expect(restartPhase.get()).toEqual({ kind: 'updated', version: '0.13.0' });
    expect(rig.asked).toEqual(['UpdateApply', 'UpdateGetStatus']);
    rig.advance(RESTART_DEADLINE_MS);
    expect(restartPhase.get().kind).toBe('updated');
  });

  it('that comes back as the old version is not an update', async () => {
    const rig = new Rig();
    restartToUpdate('0.13.0', '0.11.0', rig.ports());
    await settle();
    rig.reconnect('0.11.0');
    expect(restartPhase.get().kind).toBe('restarting');
    rig.advance(RESTART_DEADLINE_MS);
    expect(restartPhase.get().kind).toBe('failed');
  });

  it('that the agent refuses fails at once with its reason', async () => {
    const rig = new Rig();
    rig.agent = { current: '0.11.0', lastError: 'Nothing was installed: Citadel Agent.app is not listening' };
    rig.apply = Promise.resolve(rig.status());
    rig.agent = { current: '0.11.0', lastError: null };
    restartToUpdate('0.13.0', '0.11.0', rig.ports());
    await settle();
    expect(restartPhase.get()).toEqual({ kind: 'failed', target: '0.13.0', message: 'Nothing was installed: Citadel Agent.app is not listening' });
  });

  it('carries a reason the agent recorded during the wait into the failure', async () => {
    const rig = new Rig();
    restartToUpdate('0.13.0', '0.11.0', rig.ports());
    await settle();
    rig.agent = { current: '0.11.0', lastError: 'Installing 0.13.0 failed: Citadel Agent.app did not start installing 0.13.0 within 60s' };
    rig.advance(RESTART_DEADLINE_MS);
    const phase = restartPhase.get();
    expect(phase.kind === 'failed' && phase.message).toMatch(/still 0\.11\.0\. Installing 0\.13\.0 failed/);
  });
});
