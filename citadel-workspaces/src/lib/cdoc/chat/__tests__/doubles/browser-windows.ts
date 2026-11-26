/**
 * One member's windows of one browser, each with its OWN instance of the chat document modules
 * (vi.resetModules, then import): what a window keeps in module scope (the open set, the
 * per-tab queues) is its own, exactly as in two tabs. What windows share is shared here too: the
 * agent's LocalDB (fake: it is behind a WebSocket), Node's real BroadcastChannel, the browser's
 * locks (memory: Node 20 has no Web Locks API) and time. Replicas are the production
 * EditorSession on the real cdoc wasm, and each open document view has ONE runtime, as
 * use-docs-document gives it: every replica the view's keeper opens goes into that runtime,
 * which holds one editor (a second open replaces the first there, as in the app).
 */
import { BroadcastChannel } from 'node:worker_threads';
import { vi } from 'vitest';
import type { EditorSession } from '../../../editor/editor-session';
import type { EditorOrigin } from '../../../editor/controller';
import type { HexColor } from '../../../editor/model-values';
import { ManualClock } from '../../../collab/__tests__/doubles/manual-clock';
import { inProcessRuntime, type TestRuntime } from '../../../__tests__/wasm-rig';
import { NO_PICTURES } from '../../../__tests__/no-pictures';
import { createEditorOpener } from '../../../editor/editor-opener';
import { CHAT_SYNC, type ChatSyncConfig } from '../../chat-config';
import type { LocalDbPort } from '../../chat-local-db';
import type { ChatStoreBackend, ChatTransport } from '../../chat-ports';
import type { ChatSyncProblem } from '../../chat-problems';
import type { ChatDocumentOrigin } from '../../chat-replica-keeper';
import type { InboxOutcome } from '../../chat-inbox';
import type { CdocChatCommandEvent } from '@/types/cdoc-chat-sync';
import type { ExclusiveLocks, TabChannel } from '../../chat-tabs';
import { memoryExclusiveLocks } from './browser-tabs';
import { FakeAgentLocalDb } from './fake-agent-local-db';
import { apartSnapshotDiff } from './apart-snapshot-diff';

export interface Browser {
  readonly db: FakeAgentLocalDb;
  readonly locks: ExclusiveLocks;
  readonly clock: ManualClock;
  /** Closes every window's channel (Node keeps the process alive while one is open). */
  shut(): void;
  /** A real BroadcastChannel on `name`, closed by shut(). */
  channel(name: string): TabChannel;
}

export function newBrowser(): Browser {
  const opened: BroadcastChannel[] = [];
  return {
    db: new FakeAgentLocalDb(),
    locks: memoryExclusiveLocks(),
    clock: new ManualClock(),
    shut: (): void => { for (const channel of opened.splice(0)) channel.close(); },
    channel: (name: string): TabChannel => {
      const channel: BroadcastChannel = new BroadcastChannel(name);
      opened.push(channel);
      return {
        postMessage: (message: unknown): void => channel.postMessage(message),
        addEventListener: (_type: 'message', listener: (event: { readonly data: unknown }) => void): void => {
          channel.addEventListener('message', (event: Event): void => listener(event as unknown as { readonly data: unknown }));
        },
      };
    },
  };
}

export interface OpenDocument {
  readonly problems: ChatSyncProblem[];
  editor(): EditorSession;
  /** Closes the view; resolves once its last write is done and its replica disposed. */
  close(): Promise<void>;
}

export interface BrowserWindow {
  readonly store: ChatStoreBackend;
  open(docId: string, transport: ChatTransport, origin: ChatDocumentOrigin, config: ChatSyncConfig): Promise<OpenDocument>;
  /** What this window's inbox (bindChatDocumentInbox) does with a command the peer sent. */
  record(event: CdocChatCommandEvent): Promise<InboxOutcome>;
}

const COLOR: HexColor = '#4F46E5';

/** A new window of `account`'s, on its own module instances; `port` is its connection to the agent (default: a plain one). */
export async function openWindow(browser: Browser, account: bigint, port: LocalDbPort | null): Promise<BrowserWindow> {
  vi.resetModules();
  const [{ chatReplicaKeeper }, { localDbChatStore }, { chatTabs, CHAT_TABS_CHANNEL }, { recordClosedDocumentCommand }] = await Promise.all([
    import('../../chat-replica-keeper'), import('../../chat-local-db'), import('../../chat-tabs'), import('../../chat-inbox'),
  ]);
  const store: ChatStoreBackend = localDbChatStore(account, port ?? browser.db.connection([account]), chatTabs(browser.locks, browser.channel(CHAT_TABS_CHANNEL)));
  const open = async (docId: string, transport: ChatTransport, origin: ChatDocumentOrigin, config: ChatSyncConfig): Promise<OpenDocument> => {
    const problems: ChatSyncProblem[] = [];
    let editor: EditorSession | null = null;
    let disposed: () => void = (): void => undefined;
    const gone: Promise<void> = new Promise<void>((resolve: () => void): void => { disposed = resolve; });
    const runtime: TestRuntime = inProcessRuntime('worker');
    const opener: (from: EditorOrigin) => Promise<EditorSession> = createEditorOpener(
      { client: runtime.client, renderer: runtime.renderer, pictures: NO_PICTURES }, (b: Uint8Array): Uint8Array => crypto.getRandomValues(b));
    const replica = async (from: EditorOrigin): Promise<EditorSession> => {
      const opened: EditorSession = await opener(from);
      const dispose: () => void = opened.dispose.bind(opened);
      opened.dispose = (): void => { dispose(); if (opened === editor) disposed(); };
      return opened;
    };
    let teardown: () => Promise<void> = (): Promise<void> => Promise.resolve();
    await new Promise<void>((resolve: () => void, reject: (error: unknown) => void): void => {
      teardown = chatReplicaKeeper<EditorSession>(docId, origin, config, {
        transport, clock: browser.clock, wallClock: (): number => 1_700_000_000_000 + browser.clock.now(),
        identify: (): { readonly name: string; readonly color: HexColor } => ({ name: 'Peer', color: COLOR }), store, snapshotDiff: apartSnapshotDiff,
      }, {
        report: (problem: ChatSyncProblem): void => { problems.push(problem); },
        titled: (): void => undefined,
        bound: (): void => undefined,
      })(replica, (shown: EditorSession): void => { editor = shown; resolve(); }, reject);
    });
    return {
      problems,
      editor: (): EditorSession => { if (editor === null) throw new Error('not open'); return editor; },
      close: (): Promise<void> => { void teardown(); return gone; },
    };
  };
  const record = (event: CdocChatCommandEvent): Promise<InboxOutcome> => recordClosedDocumentCommand(account, event, store, CHAT_SYNC);
  return { store, open, record };
}
