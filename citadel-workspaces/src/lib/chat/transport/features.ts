/**
 * What one conversation can do, stated once.
 *
 * The node chat answered this question four ways: `canReply/canRevise/canReact/canPageOlder`
 * computed from the channel id, a `sharesFiles` guard in the view, a `mode` prop on the direct
 * chat that toggled avatars, and controls that were simply absent. Here the answer is part of
 * the transport. Everything that has a port is derived from whether the port exists, so a
 * transport cannot claim files without a file port or carry one it says it lacks; only what has
 * no port of its own is stated, and it is stated by the adapter, never by a component prop.
 *
 * Who may send is not here. It changes while the conversation is open (a role switch), so it is
 * live state on the transport (`sendGate`), not a fixed property of the conversation.
 */
import type { ChatTransport } from './chat-transport';

/** Properties a transport states because no port carries them. */
export interface StatedFeatures {
  readonly markdown: boolean;
  readonly readReceipts: boolean;
  /** The reader picks a security level per message. */
  readonly securityLevel: boolean;
  /** History can be kept for a chosen time and cleared. */
  readonly retention: boolean;
  /** The sender's copy appears before the transport confirms it. */
  readonly optimistic: boolean;
  /** Each message shows who wrote it (a channel), rather than a two-party thread. */
  readonly namesSenders: boolean;
}

export interface ChatFeatures extends StatedFeatures {
  readonly reactions: boolean;
  /** Own messages can be edited and deleted. */
  readonly revise: boolean;
  readonly typing: boolean;
  readonly presence: boolean;
  readonly files: boolean;
  readonly documents: boolean;
  readonly settings: boolean;
}

type Ports = Pick<ChatTransport, 'send' | 'status' | 'files' | 'documents' | 'settings'>;

export function chatFeatures(ports: Ports, stated: StatedFeatures): ChatFeatures {
  return {
    ...stated,
    reactions: ports.send.react !== null,
    revise: ports.send.revise !== null,
    typing: ports.status !== null,
    presence: ports.status !== null,
    files: ports.files !== null,
    documents: ports.documents !== null,
    settings: ports.settings !== null,
  };
}
