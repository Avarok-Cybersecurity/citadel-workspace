/**
 * "Message Text in Notifications": per account, kept by the agent, off until
 * the user turns it on, and not shown at all with an agent that raises no
 * notices. The agent is a recorder answering on the app's event emitter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AccountPreferences } from 'citadel-internal-service-wasm-client';

vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({ p2pMessengerManager: { getAllConversations: (): unknown[] => [] } }));

import { NotificationPreviewRow } from '../NotificationPreviewRow';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
import { registerConversationSender } from '@/lib/agent-conversations/requests';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { eventEmitter } from '@/lib/event-emitter';

let held: AccountPreferences;
const set: AccountPreferences[] = [];

beforeEach(() => {
  set.length = 0;
  instanceManager.setCid(5n);
  held = { send_read_receipts: true, accept_requests_from_strangers: true, notify_on_screenshot: false, notification_preview: 'SenderOnly', retention: [], security_minimums: [] };
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    const [, body] = Object.entries(request)[0] as [string, { request_id: string; preferences?: AccountPreferences }];
    if (body.preferences) { held = body.preferences; set.push(body.preferences); }
    queueMicrotask(() => eventEmitter.emit('websocket-message', { AccountPreferencesResponse: { request_id: body.request_id, cid: 5n, preferences: held } }));
  });
});

describe('message text in notifications', () => {
  it('starts off, and turning it on tells the agent for this account', async () => {
    await greetAs(true);
    render(<NotificationPreviewRow />);
    const toggle: HTMLElement = await screen.findByTestId('notification-preview-switch');
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(set.map((p) => p.notification_preview)).toEqual(['Text']));
  });

  it('is not offered by an agent that raises no notices', async () => {
    await greetAs('older');
    const { container } = render(<NotificationPreviewRow />);
    // Every promise the row chains settles within one task; after it, it has decided.
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(container).toBeEmptyDOMElement();
    expect(set).toEqual([]);
  });
});
