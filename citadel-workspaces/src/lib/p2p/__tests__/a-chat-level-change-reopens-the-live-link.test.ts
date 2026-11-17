/**
 * Changing a chat's encryption level saves it and re-opens a live link at it.
 *
 * The level is read when a channel opens, so a link already up stays at the
 * old level until it is re-opened. A paused contact is saved but not dialled:
 * that would break the pause. The fakes stand in for the three I/O
 * boundaries only -- the settings store, the agent, the pause record, and the
 * P2P link. The agent is told before any redial: it answers the peer's offers
 * for this account, and must not admit a re-offer at the old level.
 */
import { describe, it, expect } from 'vitest';
import { changeChatLevel, chatLevelStatus, type ChatLevelChangeDeps, type ChatLevelResult } from '../chat-level-change';
import { DEFAULT_CHAT_ADVANCED_SETTINGS, type ChatAdvancedSettings } from '../chat-advanced-settings';
import type { PauseStatus } from '@/lib/p2p-pause/pause-rules';

interface Recorded { calls: string[]; deps: ChatLevelChangeDeps }

function fakes(connected: boolean, pause: PauseStatus, comesBack: boolean = true): Recorded {
  const calls: string[] = [];
  let stored: ChatAdvancedSettings = { ...DEFAULT_CHAT_ADVANCED_SETTINGS };
  return {
    calls,
    deps: {
      save: async (_own: bigint, _peer: bigint, change: Partial<ChatAdvancedSettings>): Promise<ChatAdvancedSettings> => {
        calls.push(`save:${String(change.securityLevel)}`);
        stored = { ...stored, ...change };
        return stored;
      },
      tellAgent: async (): Promise<void> => { calls.push('tell'); },
      pauseStatus: async (): Promise<PauseStatus> => pause,
      link: {
        isConnected: (): boolean => connected,
        drop: async (): Promise<void> => { calls.push('drop'); },
        reconnect: async (): Promise<void> => { calls.push('reconnect'); },
      },
      confirmUp: async (): Promise<boolean> => { calls.push('confirm'); return comesBack; },
    },
  };
}

describe('changing a chat encryption level', () => {
  it('saves it, then drops and redials a live link once', async () => {
    const f: Recorded = fakes(true, 'active');
    const result: ChatLevelResult = await changeChatLevel(f.deps, 1n, 2n, 'High');
    expect(f.calls).toEqual(['save:High', 'tell', 'drop', 'reconnect', 'confirm']);
    expect(result.settings.securityLevel).toBe('High');
    expect(chatLevelStatus(result)).toMatch(/Reconnected at High/);
  });

  // With a supervising agent `reconnect` only asks the agent to dial, so it resolving said
  // nothing; the tab read "Reconnected at Extreme" over a chat stuck on "Reconnecting…"
  // (owner report 2026-11-15).
  it('does not call a link reconnected until it is back', async () => {
    const f: Recorded = fakes(true, 'active', false);
    const result: ChatLevelResult = await changeChatLevel(f.deps, 1n, 2n, 'Extreme');
    expect(result.outcome).toBe('reconnect-pending');
    expect(chatLevelStatus(result)).not.toMatch(/Reconnected/);
    expect(chatLevelStatus(result)).toMatch(/Saved\. Not reconnected yet: .* at Extreme/);
  });

  it('only saves when no link is up', async () => {
    const f: Recorded = fakes(false, 'active');
    const result: ChatLevelResult = await changeChatLevel(f.deps, 1n, 2n, 'Extreme');
    expect(f.calls).toEqual(['save:Extreme', 'tell']);
    expect(chatLevelStatus(result)).toMatch(/next connection .* uses Extreme/);
  });

  it('never dials a paused contact', async () => {
    const f: Recorded = fakes(true, 'paused');
    const result: ChatLevelResult = await changeChatLevel(f.deps, 1n, 2n, 'High');
    expect(f.calls).toEqual(['save:High', 'tell']);
    expect(chatLevelStatus(result)).toMatch(/paused/);
  });

  it('treats an unreadable pause record as paused', async () => {
    const f: Recorded = fakes(true, 'unknown');
    await changeChatLevel(f.deps, 1n, 2n, 'Reinforced');
    expect(f.calls).toEqual(['save:Reinforced', 'tell']);
  });
});
