/**
 * A big send is visible and stoppable in its bubble, not stuck in the dialog.
 *
 * UX review of the staged send: the Send click waited for every chunk of a file of
 * up to 2 GB, with no progress and no way to close the dialog, while the offer was
 * already in the recipient's chat. Now the dialog's send returns as soon as the
 * bubble is shown ('preparing'); staging progress moves the bubble's bar; the offer
 * waits for the staged file; the bubble's Cancel stops the staging; a failure is the
 * bubble's. The executor is the only stand-in: it reports staging the way
 * send-transfer-request does.
 */
import { describe, it, expect } from 'vitest';
import { sendFile, cancelTransfer, type LifecycleDeps } from '../transfer-lifecycle';
import { stagingPercent } from '../deliver-send';
import { FileTransferState } from '../state';
import type { FileTransfer, StagingHooks } from '../types';

interface Agent {
  deps: LifecycleDeps;
  states: string[];
  /** Stages half, then waits for `finish`. */
  finish: (outcome: 'staged' | Error) => void;
  aborted: () => boolean;
}

function agent(): Agent {
  const state: FileTransferState = new FileTransferState();
  const states: string[] = [];
  let finish: (outcome: 'staged' | Error) => void = (): void => undefined;
  let hooks: StagingHooks | undefined;
  const deps: LifecycleDeps = {
    state,
    io: {
      getCurrentCid: async (): Promise<bigint> => 7n,
      generateThumbnail: async (): Promise<string> => 't',
      executeIntent: (intent: { type: string; staging?: StagingHooks }): Promise<unknown> => {
        if (intent.type !== 'send-transfer-request') return Promise.resolve(undefined);
        hooks = intent.staging;
        hooks?.onProgress(50, 100);
        return new Promise((resolve, reject) => {
          finish = (outcome: 'staged' | Error): void => {
            if (outcome instanceof Error) { reject(outcome); return; }
            hooks?.onStaged();
            resolve(undefined);
          };
          hooks?.signal.addEventListener('abort', () => reject(new Error('Cancelled before the file was ready.')));
        });
      },
    },
    saveTransfer: async (): Promise<void> => undefined,
    emitStateChange: (t: FileTransfer): void => { states.push(`${t.state}:${t.progress}`); },
    saveSettings: async (): Promise<void> => undefined,
    openPeerChannel: async (): Promise<boolean> => true,
    // A staging agent: the route under test.
    agentStagesUploads: async (): Promise<boolean> => true,
    queue: { peerOnlineStatus: (): boolean => true, peerName: (): string => 'Bob', hold: async (): Promise<void> => undefined, take: async (): Promise<undefined> => undefined, release: async (): Promise<void> => undefined },
  } as unknown as LifecycleDeps;
  return { deps, states, finish: (o) => finish(o), aborted: (): boolean => hooks?.signal.aborted === true };
}

const VIDEO: File = new File([new Uint8Array(10)], 'video.mov');
const tick = (): Promise<void> => new Promise((r: (v: void) => void) => setTimeout(r, 0));

describe('a big send', () => {
  it('returns to the dialog at once, its bubble preparing with the staged share', async () => {
    const a: Agent = agent();
    const id: string = await sendFile(a.deps, '42', VIDEO);
    expect(a.deps.state.getTransfer(id)?.state).toBe('preparing');
    expect(a.states).toContain('preparing:50');
    a.finish('staged');
    await tick();
    expect(a.deps.state.getTransfer(id)?.state).toBe('pending');
  });

  it('stops staging when its bubble is cancelled, and records no failure', async () => {
    const a: Agent = agent();
    const id: string = await sendFile(a.deps, '42', VIDEO);
    await cancelTransfer(a.deps, id);
    await tick();
    expect(a.aborted()).toBe(true);
    expect(a.deps.state.getTransfer(id)?.state).toBe('cancelled');
  });

  it('fails in its bubble, with the reason', async () => {
    const a: Agent = agent();
    const id: string = await sendFile(a.deps, '42', VIDEO);
    a.finish(new Error('the agent is already holding 2 GB'));
    await tick();
    expect(a.deps.state.getTransfer(id)).toMatchObject({ state: 'error', errorMessage: 'the agent is already holding 2 GB' });
  });
});

describe('stagingPercent', () => {
  it('rounds down and stays within 0-100', () => {
    expect(stagingPercent(0, 10)).toBe(0);
    expect(stagingPercent(5, 10)).toBe(50);
    expect(stagingPercent(10, 10)).toBe(100);
    expect(stagingPercent(1, 0)).toBe(0);
  });
});
