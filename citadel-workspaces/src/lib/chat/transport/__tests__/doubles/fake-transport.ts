/**
 * A transport whose every port records what it was asked and answers from a script.
 *
 * It stands at the port boundary the pane is written against (chat-transport.ts), so a test that
 * drives the pane or its hooks through it exercises all of their production code; only the
 * carrier is replaced. Tests pass the ports they want present; an absent port is null, exactly as
 * an adapter without that capability would build it, and `features` is derived the same way.
 */
import { createValueStore } from '@/lib/value-store';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import { chatFeatures, type StatedFeatures } from '../../features';
import type {
  ChatKind, ChatMessage, ChatSelf, ChatTransport, DocumentInvitation, DocumentPort, FileOpening, FilePort, FileSendReceipt,
  HistoryCursor, HistoryEvent, HistoryPage, SendPort, SettingsPort, StatusChange, StatusPort, StatusProbe, StatusSnapshot, TextSend,
} from '../../chat-transport';
import { peerOpeningPorts } from '@/components/p2p/chat-document/use-chat-documents';

export interface Recorded {
  readonly calls: string[];
  readonly texts: TextSend[];
  readonly invitations: DocumentInvitation[];
  emit(event: HistoryEvent): void;
  status(change: StatusChange): void;
  activity(docId: string): void;
}

export interface FakeOptions {
  readonly kind: ChatKind;
  readonly self: ChatSelf | null;
  readonly counterpart: string;
  readonly latest: HistoryPage;
  readonly stated: StatedFeatures;
  readonly ports: {
    readonly status: boolean; readonly files: boolean; readonly documents: boolean; readonly settings: boolean;
    readonly revise: boolean; readonly reactions: boolean;
  };
  readonly sendGate: GroupRestriction;
  /** Whether a text send records its bubble before resolving. */
  readonly recordsOnSend: boolean;
}

export function fakeTransport(options: FakeOptions): { transport: ChatTransport; recorded: Recorded } {
  const calls: string[] = [];
  const texts: TextSend[] = [];
  const invitations: DocumentInvitation[] = [];
  const history: Set<(event: HistoryEvent) => void> = new Set();
  const statuses: Set<(change: StatusChange) => void> = new Set();
  const activities: Set<(docId: string) => void> = new Set();
  const call = (name: string): void => { calls.push(name); };

  const status: StatusPort | null = !options.ports.status ? null : {
    snapshot: (): StatusSnapshot => { call('status.snapshot'); return { connected: true, presence: null, typing: [] }; },
    probe: async (): Promise<StatusProbe> => { call('status.probe'); return { connected: true, presence: null }; },
    subscribe: (listener: (change: StatusChange) => void): (() => void) => { statuses.add(listener); return (): void => { statuses.delete(listener); }; },
    startTyping: (): void => call('status.startTyping'),
    stopTyping: (): void => call('status.stopTyping'),
    acceptance: null,
  };
  const files: FilePort | null = !options.ports.files ? null : {
    modes: ['server'],
    destination: 'Stored on the workspace server.',
    dialogKey: '2',
    send: async (file: File): Promise<FileSendReceipt> => { call(`files.send:${file.name}`); return { outcome: 'offered' }; },
    accept: async (id: string): Promise<void> => call(`files.accept:${id}`),
    decline: async (id: string): Promise<void> => call(`files.decline:${id}`),
    cancel: async (id: string): Promise<void> => call(`files.cancel:${id}`),
    open: async (id: string): Promise<FileOpening> => { call(`files.open:${id}`); return { kind: 'unknown' }; },
    read: null,
  };
  const documents: DocumentPort | null = !options.ports.documents ? null : {
    sharedWith: `Shared live with ${options.counterpart}`,
    opening: peerOpeningPorts({ cid: 0n, name: options.counterpart, username: options.counterpart }),
    invite: async (invitation: DocumentInvitation): Promise<void> => { invitations.push(invitation); invitation.onRecorded(); },
    onActivity: (listener: (docId: string) => void): (() => void) => { activities.add(listener); return (): void => { activities.delete(listener); }; },
  };
  const settings: SettingsPort | null = options.ports.settings ? { key: '2' } : null;
  const send: SendPort = {
    text: async (message: TextSend): Promise<void> => { texts.push(message); if (options.recordsOnSend) message.onRecorded(); },
    revise: !options.ports.revise ? null : {
      edit: async (id: string, content: string): Promise<void> => call(`send.edit:${id}:${content}`),
      remove: async (id: string): Promise<void> => call(`send.remove:${id}`),
    },
    react: !options.ports.reactions ? null : async (id: string, emoji: string): Promise<void> => call(`send.react:${id}:${emoji}`),
    retry: async (id: string): Promise<void> => call(`send.retry:${id}`),
  };
  const ports: Pick<ChatTransport, 'send' | 'status' | 'files' | 'documents' | 'settings'> = { send, status, files, documents, settings };

  const transport: ChatTransport = {
    kind: options.kind,
    conversationKey: `fake:${options.kind}`,
    self: options.self,
    counterpart: { name: options.counterpart, username: null, greeting: `Be the first to write in ${options.counterpart}.` },
    features: chatFeatures(ports, options.stated),
    sendGate: createValueStore<GroupRestriction>('fake-send-gate', options.sendGate),
    history: {
      loadLatest: async (): Promise<HistoryPage> => { call('history.loadLatest'); return options.latest; },
      loadOlder: async (cursor: HistoryCursor): Promise<HistoryPage> => { call(`history.loadOlder:${cursor.kind}`); return { messages: [], older: null }; },
      cached: (): readonly ChatMessage[] => [],
      subscribe: (listener: (event: HistoryEvent) => void): (() => void) => { call('history.subscribe'); history.add(listener); return (): void => { history.delete(listener); }; },
      markRead: async (ids: readonly string[] | null): Promise<void> => call(`history.markRead:${ids === null ? 'all' : ids.join(',')}`),
      focus: (): (() => void) => { call('history.focus'); return (): void => call('history.blur'); },
      clearNotices: (): void => call('history.clearNotices'),
    },
    ...ports,
    reactorName: (cid: bigint): string => (cid === options.self?.cid ? 'You' : `member ${cid.toString()}`),
  };
  return {
    transport,
    recorded: {
      calls, texts, invitations,
      emit: (event: HistoryEvent): void => history.forEach((l: (event: HistoryEvent) => void): void => l(event)),
      status: (change: StatusChange): void => statuses.forEach((l: (change: StatusChange) => void): void => l(change)),
      activity: (docId: string): void => activities.forEach((l: (docId: string) => void): void => l(docId)),
    },
  };
}

/** A message in a fake conversation; `own` says whose. */
export function fakeMessage(id: string, content: string, timestamp: number, own: boolean): ChatMessage {
  return {
    id, content, timestamp, index: 0, status: 'delivered', message_type: 'text',
    senderCid: own ? 1n : 2n, recipientCid: own ? 2n : 1n,
    author: own ? { own: true, name: 'You', username: null } : { own: false, name: 'Bob', username: 'bob' },
    share: null,
  };
}
