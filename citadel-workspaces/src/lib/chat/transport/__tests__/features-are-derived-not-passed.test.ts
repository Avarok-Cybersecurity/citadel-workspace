/**
 * A conversation's features come from its transport's ports, not from a flag beside them.
 *
 * The node chat said what it could do in four places that disagreed (a per-id action table, a
 * `sharesFiles` guard, a `mode` prop, and absent controls). A feature that has a port is now true
 * exactly when the port exists, so "has files" and "can send a file" cannot drift apart.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ChatPane } from '@/components/chat/pane/ChatPane';
import { chatFeatures, type StatedFeatures } from '../features';
import { createPeerTransport } from '../peer-transport';
import type { ChatTransport } from '../chat-transport';
import { peerOpeningPorts } from '@/components/p2p/chat-document/use-chat-documents';

vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({ P2PMessengerManager: { getInstance: (): object => ({}) } }));

const STATED: StatedFeatures = { markdown: true, readReceipts: true, securityLevel: true, retention: true, optimistic: true, namesSenders: false };
const BARE_SEND: ChatTransport['send'] = { text: async (): Promise<void> => undefined, revise: null, react: null, retry: async (): Promise<void> => undefined };
const NONE: Pick<ChatTransport, 'send' | 'status' | 'files' | 'documents' | 'settings'> = { send: BARE_SEND, status: null, files: null, documents: null, settings: null };

describe('chat features', () => {
  it('are false for every port a transport does not have', () => {
    expect(chatFeatures(NONE, STATED)).toMatchObject({ typing: false, presence: false, files: false, documents: false, settings: false, reactions: false, revise: false });
  });

  it('follow each port on its own', () => {
    const peer: ChatTransport = createPeerTransport({ peer: { cid: 7n, name: 'Bob', username: 'bob' }, self: null, opening: peerOpeningPorts({ cid: 7n, name: 'Bob', username: 'bob' }) });
    expect(chatFeatures({ ...NONE, files: peer.files }, STATED)).toMatchObject({ files: true, documents: false });
    expect(chatFeatures({ ...NONE, documents: peer.documents }, STATED)).toMatchObject({ files: false, documents: true });
    expect(chatFeatures({ ...NONE, send: { ...BARE_SEND, react: peer.send.react } }, STATED)).toMatchObject({ reactions: true, revise: false });
    expect(chatFeatures({ ...NONE, send: { ...BARE_SEND, revise: peer.send.revise } }, STATED)).toMatchObject({ reactions: false, revise: true });
  });

  it('of the direct chat are all present, as before the port existed', () => {
    const peer: ChatTransport = createPeerTransport({ peer: { cid: 7n, name: 'Bob', username: 'bob' }, self: null, opening: peerOpeningPorts({ cid: 7n, name: 'Bob', username: 'bob' }) });
    expect(peer.features).toEqual({ ...STATED, reactions: true, revise: true, typing: true, presence: true, files: true, documents: true, settings: true });
    expect(peer.features).toEqual(chatFeatures(peer, STATED));
  });
});

describe('the chat pane', () => {
  it('takes no feature beside its transport', () => {
    // Checked by the compiler: a feature handed to the pane as a prop is a second answer to what
    // the transport already says, and `tsc` rejects the excess property. If ChatPane ever grows
    // such a prop, this expectation of an error is itself the error.
    const props: ComponentProps<typeof ChatPane> = {
      transport: createPeerTransport({ peer: { cid: 7n, name: 'Bob', username: 'bob' }, self: null, opening: peerOpeningPorts({ cid: 7n, name: 'Bob', username: 'bob' }) }),
      header: (): null => null,
      pause: null,
      // @ts-expect-error -- what the pane can do is the transport's to say.
      canReact: true,
    };
    expect(Object.keys(props)).toContain('transport');
  });
});
