/**
 * A stand-in for the agent's updater, answering on the app's event emitter as the real one
 * answers over the socket: every request gets an UpdateStatus with its request_id.
 */
import type { UpdateAvailable, UpdateStatus } from 'citadel-internal-service-wasm-client';
import { registerConversationSender } from '@/lib/agent-conversations/sender';
import { eventEmitter } from '@/lib/event-emitter';

export const RELEASE: string = 'https://github.com/Avarok-Cybersecurity/citadel-workspace/releases/';

export function available(ready: boolean, latest: string = '0.9.0'): UpdateAvailable {
  return {
    cid: 0n, current: '0.8.8', latest, ready, request_id: null,
    // The agent stages nothing whose ML-DSA release signature did not verify.
    mldsa_verified: ready,
    notes_url: `${RELEASE}tag/agent-v${latest}`,
    download_url: ready ? `${RELEASE}download/agent-v${latest}/Citadel-Agent.dmg` : `${RELEASE}download/agent-v${latest}/citadel-agent-linux-x64.deb`,
  };
}

export interface FakeUpdater {
  /** Every request, by variant, with its body. */
  asked: Array<[string, Record<string, unknown>]>;
  status: Omit<UpdateStatus, 'request_id'>;
  /** Answer nothing, as an agent that restarted to install does. */
  silent: boolean;
}

export function fakeUpdater(update: UpdateAvailable | null): FakeUpdater {
  const fake: FakeUpdater = {
    asked: [],
    silent: false,
    status: { cid: 0n, current: '0.8.8', available: update, auto_install: true, last_checked: 1790000000n, last_error: null },
  };
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
    fake.asked.push([variant, body]);
    if (variant === 'UpdateSetSettings') fake.status = { ...fake.status, auto_install: body.auto_install as boolean };
    if (fake.silent) return;
    const answer: UpdateStatus = { ...fake.status, request_id: body.request_id as string };
    queueMicrotask(() => eventEmitter.emit('websocket-message', { UpdateStatus: answer }));
  });
  return fake;
}
