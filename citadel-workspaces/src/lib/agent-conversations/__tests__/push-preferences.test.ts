/**
 * A window's push of its settings keeps the account's notification preview,
 * which only the agent holds: per account, SenderOnly until the user turns
 * previews on. Over the real request path; the agent is a recorder answering
 * on the app's event emitter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { AccountPreferences } from 'citadel-internal-service-wasm-client';
import { pushAccountPreferences } from '../push-preferences';
import { registerConversationSender } from '../requests';
import { eventEmitter } from '../../event-emitter';

const ME: bigint = 3n;
let held: AccountPreferences;
const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  held = { send_read_receipts: true, accept_requests_from_strangers: true, notify_on_screenshot: false, notification_preview: 'Text', retention: [], security_minimums: [] };
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    const [variant, body] = Object.entries(request)[0] as [string, { request_id: string; preferences?: AccountPreferences }];
    asked.push(variant);
    if (body.preferences) held = body.preferences;
    queueMicrotask(() => eventEmitter.emit('websocket-message', { AccountPreferencesResponse: { request_id: body.request_id, cid: ME, preferences: held } }));
  });
});

describe('pushing the account preferences', () => {
  it('keeps the preview the agent holds', async () => {
    await pushAccountPreferences(ME, () => []);
    expect(asked).toEqual(['GetAccountPreferences', 'SetAccountPreferences']);
    expect(held.notification_preview).toBe('Text');
  });

  it('sets the preview when the user changes it', async () => {
    await pushAccountPreferences(ME, () => [], 'SenderOnly');
    expect(asked).toEqual(['SetAccountPreferences']);
    expect(held.notification_preview).toBe('SenderOnly');
  });
});
