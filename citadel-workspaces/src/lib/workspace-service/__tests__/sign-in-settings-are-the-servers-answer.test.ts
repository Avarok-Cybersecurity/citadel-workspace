/**
 * The sign-in settings requests resolve with what the SERVER answered, never
 * with what was asked: an update's answer is read back from where the
 * server's admission check reads it, and a refusal rejects with its reason.
 *
 * Doubled: the send (the wire) and the inbound event, as every write-gate test
 * here does; the request shapes, the gate and the parsing are the production ones.
 */
import { describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { getSignInSettings, parseSignInSettings, updateSignInSettings } from '../sign-in-settings';
import type { ProtocolSender } from '../workspace-operations';

type Sender = ProtocolSender & { sent: WorkspaceProtocolRequestTS[] };

/** A sender whose server answers each request with `answer(request)`. */
function sender(answer: (request: WorkspaceProtocolRequestTS) => unknown[]): Sender {
  const sent: WorkspaceProtocolRequestTS[] = [];
  return {
    sent,
    currentCid: 7n,
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequestTS): Promise<void> => {
      sent.push(request);
      for (const response of answer(request)) setTimeout(() => eventEmitter.emit('workspace:raw-response', response), 0);
    }),
  };
}

describe('the sign-in settings requests', () => {
  it('read: sends GetSignInSettings and resolves with the settings answered', async () => {
    const s: Sender = sender(() => [{ SignInSettings: { require_turnstile_sign_in: true } }]);
    expect(await getSignInSettings(s)).toEqual({ require_turnstile_sign_in: true });
    expect(s.sent).toEqual([{ GetSignInSettings: null }]);
  });

  it('update: sends the settings and resolves with the server\'s answer, not the request', async () => {
    const s: Sender = sender(() => [{ SignInSettings: { require_turnstile_sign_in: false } }]);
    expect(await updateSignInSettings(s, { require_turnstile_sign_in: true })).toEqual({ require_turnstile_sign_in: false });
    expect(s.sent).toEqual([{ UpdateSignInSettings: { settings: { require_turnstile_sign_in: true } } }]);
  });

  it('skips an answer that carries no settings, and takes the next that does', async () => {
    const s: Sender = sender(() => [{ SignInSettings: { require_turnstile_sign_in: 'yes' } }, { SignInSettings: { require_turnstile_sign_in: true } }]);
    expect(await getSignInSettings(s)).toEqual({ require_turnstile_sign_in: true });
  });

  it('rejects with the server\'s refusal', async () => {
    const s: Sender = sender(() => [{ Error: 'Permission denied: only an admin can change how people sign in to this workspace' }]);
    await expect(updateSignInSettings(s, { require_turnstile_sign_in: true })).rejects.toThrow('only an admin');
  });

  it('reads only a boolean as the setting', () => {
    expect(parseSignInSettings({ require_turnstile_sign_in: false })).toEqual({ require_turnstile_sign_in: false });
    expect(parseSignInSettings({ require_turnstile_sign_in: 1 })).toBeNull();
    expect(parseSignInSettings({})).toBeNull();
    expect(parseSignInSettings(null)).toBeNull();
  });
});
