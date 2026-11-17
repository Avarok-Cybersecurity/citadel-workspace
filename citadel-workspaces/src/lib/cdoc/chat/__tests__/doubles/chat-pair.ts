/**
 * Two people's chat sessions on one chat document, each the production keeper (and so the
 * production sync and store) over a real replica: the production EditorSession on the vendored
 * cdoc wasm, in process. Only the channel (fake-channel.ts), the agent's LocalDB
 * (fake-agent-local-db.ts) and time (ManualClock) are stand-ins: the network, the agent and the
 * clock, never the CRDT.
 */
import type { CdocChatTitleStamp } from '@/types/cdoc-chat-sync';
import type { EditorSession } from '../../../editor/editor-session';
import type { EditorOrigin } from '../../../editor/controller';
import type { HexColor } from '../../../editor/model-values';
import { ManualClock } from '../../../collab/__tests__/doubles/manual-clock';
import { realReplicas } from '../../../collab/__tests__/doubles/real-replicas';
import { realEngine } from '../../../__tests__/wasm-rig';
import type { EditorEngine } from '../../../engine/editor-engine';
import { CHAT_SYNC, type ChatSyncConfig } from '../../chat-config';
import { localDbChatStore } from '../../chat-local-db';
import type { ChatSyncProblem } from '../../chat-problems';
import { chatReplicaKeeper, type ChatDocumentOrigin } from '../../chat-replica-keeper';
import type { ChatDocumentSync } from '../../chat-sync';
import type { Keeper } from '../../../collab/replica-keeper';
import { CLEAN, FakeChannel, type Faults } from './fake-channel';
import { FakeAgentLocalDb } from './fake-agent-local-db';
import { Rng } from './rng';

export const ALICE: bigint = 10_000_000_000_000_000_001n;
export const BOB: bigint = 10_000_000_000_000_000_002n;
export const DOC: string = 'chat-doc-1';
export const BLANK: ChatDocumentOrigin = { kind: 'blank' };

export interface ChatSide {
  readonly cid: bigint;
  readonly db: FakeAgentLocalDb;
  readonly problems: ChatSyncProblem[];
  readonly titles: CdocChatTitleStamp[];
  /** Each time the peer's copy was found to be moved from another original: what it named. */
  readonly heldApart: (string | null)[];
  editor(): EditorSession;
  sync(): ChatDocumentSync;
  /** The keeper's teardown, as closing the document's view runs it; resolves once its replica is disposed (its last write done). */
  close(): Promise<void>;
}

export interface World {
  readonly channel: FakeChannel;
  readonly clock: ManualClock;
}

export function newWorld(): World {
  return { channel: new FakeChannel(), clock: new ManualClock() };
}

const COLOR: HexColor = '#4F46E5';

/** Opens `self`'s view of the document (chatting with `peer`), its copy kept in `db`. */
export async function openSide(world: World, self: bigint, peer: bigint, db: FakeAgentLocalDb, origin: ChatDocumentOrigin, config: ChatSyncConfig = CHAT_SYNC): Promise<ChatSide> {
  const problems: ChatSyncProblem[] = [];
  const titles: CdocChatTitleStamp[] = [];
  const heldApart: (string | null)[] = [];
  let editor: EditorSession | null = null;
  let sync: ChatDocumentSync | null = null;
  // Wall time for title stamps: fixed and moving only with the manual clock.
  const wallClock = (): number => 1_700_000_000_000 + world.clock.now();
  const keep: Keeper<EditorSession> = chatReplicaKeeper<EditorSession>(DOC, origin, config, {
    transport: world.channel.transport(self, peer),
    clock: world.clock,
    wallClock,
    identify: (): { readonly name: string; readonly color: HexColor } => ({ name: 'Peer', color: COLOR }),
    store: localDbChatStore(self, db.connection([self])),
  }, {
    report: (problem: ChatSyncProblem): void => { problems.push(problem); },
    titled: (stamp: CdocChatTitleStamp): void => { titles.push(stamp); },
    bound: (bound: ChatDocumentSync | null): void => { if (bound !== null) sync = bound; },
    heldApart: (theirs: string | null): void => { heldApart.push(theirs); },
  });
  let teardown: () => void = (): void => undefined;
  let disposed: () => void = (): void => undefined;
  const gone: Promise<void> = new Promise<void>((resolve: () => void): void => { disposed = resolve; });
  // Observed, not replaced: the real dispose runs, and the test learns the keeper got there.
  const open = async (from: EditorOrigin): Promise<EditorSession> => {
    const opened: EditorSession = await realReplicas().open(from);
    const dispose: () => void = opened.dispose.bind(opened);
    opened.dispose = (): void => { dispose(); disposed(); };
    return opened;
  };
  await new Promise<void>((resolve: () => void, reject: (error: unknown) => void): void => {
    teardown = keep(open, (shown: EditorSession): void => { editor = shown; resolve(); }, reject);
  });
  const close = (): Promise<void> => {
    teardown();
    return gone;
  };
  return {
    cid: self, db, problems, titles, heldApart, close,
    editor: (): EditorSession => { if (editor === null) throw new Error('not open'); return editor; },
    sync: (): ChatDocumentSync => { if (sync === null) throw new Error('not bound'); return sync; },
  };
}

async function idle(sides: readonly ChatSide[]): Promise<void> {
  for (let i: number = 0; i < 3; i += 1) await Promise.all(sides.map((s: ChatSide): Promise<void> => s.sync().settled()));
}

/**
 * Runs time and the channel until nothing is in flight for longer than the sync waits before
 * asking again, delivering with `faults`. Throws when it never goes quiet.
 */
export async function settle(world: World, sides: readonly ChatSide[], rng: Rng = new Rng(1), faults: Faults = CLEAN): Promise<void> {
  const quietRoundsNeeded: number = Math.ceil(CHAT_SYNC.askAfterMs / CHAT_SYNC.updateCoalesceMs) + 2;
  let quiet: number = 0;
  for (let round: number = 0; round < 1_000; round += 1) {
    world.clock.advance(CHAT_SYNC.updateCoalesceMs);
    await idle(sides);
    const arrived: number = world.channel.deliver(rng, faults);
    await idle(sides);
    quiet = arrived === 0 && world.channel.inFlightCount === 0 ? quiet + 1 : 0;
    if (quiet >= quietRoundsNeeded) return;
  }
  throw new Error('the two sides never went quiet');
}

/** The document a snapshot holds, as model JSON, read by a replica of its own on the real engine. */
export async function modelJson(snapshot: Uint8Array): Promise<string> {
  const engine: EditorEngine = await realEngine().openEditor(77n, { kind: 'snapshot', snapshot });
  try {
    return engine.modelJson();
  } finally {
    engine.dispose();
  }
}

/** Byte-equal snapshots (cdoc-crdt's are canonical) and equal model JSON. */
export async function sameDocument(a: EditorSession, b: EditorSession): Promise<{ readonly snapshots: boolean; readonly models: boolean }> {
  const [sa, sb] = await Promise.all([a.snapshot(), b.snapshot()]);
  const [ma, mb] = await Promise.all([modelJson(sa), modelJson(sb)]);
  return { snapshots: Array.from(sa).join(',') === Array.from(sb).join(','), models: ma === mb };
}

/** The replica's text is in its snapshot's text section, as UTF-8. */
export async function textOf(editor: EditorSession): Promise<string> {
  return new TextDecoder('utf-8', { fatal: false }).decode(await editor.snapshot());
}
