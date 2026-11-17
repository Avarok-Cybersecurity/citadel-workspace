/**
 * "Seen" means seen. A message that arrives while the window is in front but
 * the reader is scrolled up stays unread (it is counted in the notch); it is
 * read when they click View or scroll to the bottom.
 *
 * The chat's own wiring (useP2PMessages + useStickToBottom + useCatchUpRead)
 * with the real messenger and agent request path. Stand-ins: the fake agent
 * and `document.hasFocus` (hosting-agent.ts), and the viewport's geometry,
 * `scrollTo`, which jsdom lacks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, type RenderResult } from '@testing-library/react';
import { useRef, type RefObject, type MutableRefObject } from 'react';
import { P2PMessengerManager, type P2PMessage } from '@/lib/p2p';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { useP2PMessages } from '../useP2PMessages';
import { useCatchUpRead } from '../use-catch-up-read';
import { useStickToBottom, type StickToBottom } from '@/components/chat/use-stick-to-bottom';
import { NewMessagesPill } from '@/components/chat/NewMessagesPill';
import { installHostingAgent, settle, PEER, OWN, type HostingAgent } from './hosting-agent';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';

const geometry: { scrollTop: number; scrollHeight: number; clientHeight: number } = { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 };
let agent: HostingAgent;
let transport: ChatTransport;
const onUnreadMessage: () => void = (): void => {};
let deliver: ((m: P2PMessage) => void) | null;

function Chat({ hidden = false }: { hidden?: boolean }): JSX.Element {
  const viewport: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const tab: MutableRefObject<string> = useRef<string>('messages');
  const pinnedRef: MutableRefObject<boolean> = useRef<boolean>(true);
  const { messages } = useP2PMessages({ transport, activeTabIdRef: tab, scrollRef: viewport, pinnedRef, onUnreadMessage });
  const onCaughtUp: () => void = useCatchUpRead(transport.history, tab, pinnedRef);
  const stick: StickToBottom = useStickToBottom(viewport, messages, 'Messages with Alice', undefined, { pinnedRef, onCaughtUp });
  return (
    <div>
      {!hidden && <div
        data-testid="viewport"
        ref={(el) => {
          (viewport as { current: HTMLDivElement | null }).current = el;
          if (!el) return;
          for (const key of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) {
            Object.defineProperty(el, key, { configurable: true, get: () => geometry[key], set: (v: number) => { geometry[key] = v; } });
          }
          el.scrollTo = vi.fn() as unknown as typeof el.scrollTo;
        }}
      ><div /></div>}
      <NewMessagesPill count={stick.unseen} onView={stick.reveal} />
    </div>
  );
}

async function mountChat(): Promise<RenderResult> {
  const messenger: P2PMessengerManager = P2PMessengerManager.getInstance();
  const real: P2PMessengerManager['onMessage'] = messenger.onMessage.bind(messenger);
  vi.spyOn(messenger, 'onMessage').mockImplementation((cb) => { deliver = cb; return real(cb); });
  const view: RenderResult = render(<ConfirmDialogProvider><Chat /></ConfirmDialogProvider>);
  await settle();
  return view;
}

let counter: number = 0;
async function arrive(): Promise<void> {
  counter += 1;
  act(() => { deliver?.({ id: `m${counter}`, senderCid: PEER, recipientCid: OWN, timestamp: counter } as unknown as P2PMessage); });
  await settle();
}

/** A conversation with history: the first message into an empty one is a first paint, not an arrival. */
let view: RenderResult;
async function mountWithHistory(): Promise<void> {
  view = await mountChat();
  await arrive();
}

const scrollTo = async (top: number): Promise<void> => {
  geometry.scrollTop = top;
  fireEvent.scroll(screen.getByTestId('viewport'));
  await settle();
};

beforeEach(async () => {
  agent = await installHostingAgent();
  transport = peerTransportFor({ cid: PEER, name: 'Alice' }, OWN);
  agent.setFocused(true);
  geometry.scrollTop = 600; geometry.scrollHeight = 1000; geometry.clientHeight = 400;
  deliver = null;
});
afterEach(() => vi.restoreAllMocks());

describe('a message arriving in a window that is in front', () => {
  it('is read when the reader is at the bottom', async () => {
    await mountWithHistory();
    await scrollTo(600);
    agent.clear();
    await arrive();
    expect(agent.markReads()).toHaveLength(1);
  });

  it('stays unread while the reader is scrolled up, and sends no ack', async () => {
    await mountWithHistory();
    await scrollTo(100);
    agent.clear();
    await arrive();
    expect(screen.getByTestId('new-messages-pill').textContent).toContain('1 new message');
    expect(agent.markReads()).toHaveLength(0);
  });

  it('is read when the reader clicks View', async () => {
    await mountWithHistory();
    await scrollTo(100);
    await arrive();
    agent.clear();
    fireEvent.click(screen.getByRole('button', { name: /view/i }));
    await settle();
    expect(agent.markReads()).toHaveLength(1);
  });

  it('is read when the reader scrolls to the bottom by hand', async () => {
    await mountWithHistory();
    await scrollTo(100);
    await arrive();
    agent.clear();
    await scrollTo(600);
    expect(agent.markReads()).toHaveLength(1);
  });

  it('is not read on regaining focus while the reader is still scrolled up', async () => {
    await mountWithHistory();
    await scrollTo(100);
    await arrive();
    agent.clear();
    act(() => { window.dispatchEvent(new Event('focus')); });
    await settle();
    expect(agent.markReads()).toHaveLength(0);
  });

  it('is read when the reader returns to the Messages tab, and later arrivals are read too', async () => {
    await mountWithHistory();
    await scrollTo(100);
    await arrive();
    agent.clear();
    view.rerender(<ConfirmDialogProvider><Chat hidden /></ConfirmDialogProvider>); // a document tab is showing
    await settle();
    expect(agent.markReads()).toHaveLength(0);
    view.rerender(<ConfirmDialogProvider><Chat /></ConfirmDialogProvider>); // back at the bottom
    await settle();
    expect(agent.markReads()).toHaveLength(1);
    agent.clear();
    await arrive();
    expect(agent.markReads()).toHaveLength(1);
  });
});
