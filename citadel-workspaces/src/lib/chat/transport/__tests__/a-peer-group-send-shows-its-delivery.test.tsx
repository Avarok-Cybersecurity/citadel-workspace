/**
 * The server's answer to one of the reader's own peer-group messages reaches its bubble.
 *
 * It arrives after the message is shown, so the pane hears it as an update; a message shown or
 * reloaded after it arrived carries it from the start. Someone else's message never carries one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BubbleFooter } from '@/components/p2p/bubbles/BubbleFooter';
import { expectSendOutcome, forgetSendOutcomes, recordSendOutcome } from '@/lib/group-conversations/group-send-outcomes';
import { withSendNotes } from '../peer-group-send-notes';
import type { ChatMessage, HistoryEvent, HistoryPage, HistoryPort } from '../chat-transport';

const GROUP: string = '7:42';
const nameOf = (cid: bigint): string => (cid === 8n ? 'bea' : `cid-${cid.toString()}`);

function message(id: string, own: boolean): ChatMessage {
  return {
    id, content: 'hi', timestamp: 1, status: 'sent', share: null,
    author: { own, name: own ? 'You' : 'bea', username: own ? null : 'bea' },
  } as ChatMessage;
}

/** A history port whose transcript and events the test drives: the inner port is the code under the wrapper. */
function inner(held: ChatMessage[]): { port: HistoryPort; emit: (e: HistoryEvent) => void } {
  const listeners: Set<(e: HistoryEvent) => void> = new Set();
  const page: HistoryPage = { messages: held, older: null };
  return {
    emit: (e: HistoryEvent): void => listeners.forEach((l) => l(e)),
    port: {
      loadLatest: async (): Promise<HistoryPage> => page,
      loadOlder: async (): Promise<HistoryPage> => page,
      cached: (): readonly ChatMessage[] => held,
      subscribe: (l: (e: HistoryEvent) => void): (() => void) => { listeners.add(l); return (): void => { listeners.delete(l); }; },
      markRead: async (): Promise<void> => undefined,
      focus: (): (() => void) => (): void => undefined,
      clearNotices: (): void => undefined,
    },
  };
}

describe("a peer-group send's delivery note", () => {
  beforeEach((): void => forgetSendOutcomes());

  it('updates the shown message when the answer arrives, and only for this group', () => {
    const { port } = inner([message('m1', true)]);
    const seen: HistoryEvent[] = [];
    const stop: () => void = withSendNotes(port, GROUP, nameOf).subscribe((e) => seen.push(e));
    expectSendOutcome('r-other', '7:99', 'x1');
    recordSendOutcome('r-other', { delivery: { Relayed: { delivered: [8n], stored: [], not_delivered: [] } } });
    expectSendOutcome('r1', GROUP, 'm1');
    recordSendOutcome('r1', { delivery: { Relayed: { delivered: [], stored: [], not_delivered: [[8n, 'BacklogFull']] } } });
    stop();
    expect(seen).toEqual([{ kind: 'updated', message: { id: 'm1', sendNote: { text: "Couldn't reach bea (backlog full)", failed: false } } }]);
  });

  it('is on a message reloaded after it arrived, and never on someone else’s', async () => {
    expectSendOutcome('r1', GROUP, 'm1');
    expectSendOutcome('r2', GROUP, 'm2');
    recordSendOutcome('r1', { delivery: { NotRelayed: 'NoGroupKey' } });
    recordSendOutcome('r2', { delivery: { NotRelayed: 'NoGroupKey' } });
    const { port } = inner([message('m1', true), message('m2', false)]);
    const loaded: HistoryPage = await withSendNotes(port, GROUP, nameOf).loadLatest();
    expect(loaded.messages.map((m) => m.sendNote)).toEqual([{ text: "Not sent: this device does not hold the group's keys yet", failed: true }, undefined]);
  });

  it('is drawn under the own bubble, and not under anyone else’s', () => {
    const noted: ChatMessage = { ...message('m1', true), sendNote: { text: 'Delivered to 1 · held for 2 offline', failed: false } };
    const { unmount } = render(<BubbleFooter message={noted} isOwn={true} />);
    expect(screen.getByTestId('message-send-note').textContent).toBe('Delivered to 1 · held for 2 offline');
    unmount();
    render(<BubbleFooter message={noted} isOwn={false} />);
    expect(screen.queryByTestId('message-send-note')).toBeNull();
  });
});
