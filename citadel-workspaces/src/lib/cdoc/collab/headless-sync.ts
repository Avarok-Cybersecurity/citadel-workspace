/**
 * Sends a document's edits held on this device when no tab here has it open: sharing it from
 * the sidebar or the file manager. Only when closed tabs left edits does it load Citadel Docs
 * and open a session, the production one, which takes them over, sends them (Save), and is
 * closed once the server has acknowledged them or `timeoutMs` has passed. Edits not
 * acknowledged by then stay on this device, held as that session's, for the next open.
 */
import type { EditorOrigin } from '../editor/controller';
import { createEditorOpener } from '../editor/editor-opener';
import type { EditorSession } from '../editor/editor-session';
import { loadCdocRuntime } from '../runtime-loader';
import type { CdocRuntime } from '../runtime';
import { DocumentSession } from './document-session';
import type { Clock, DocumentCache, DocumentSessionPorts, HeldEdits } from './ports';
import { R1_COLLABORATION } from './replica-keeper';
import type { SaveInputs } from '@/lib/document-save/save-status';
import { randomClientSeqBase, workspaceCollabPorts } from './workspace-ports';
import { browserClock } from '@/lib/browser-clock';
import type { DocumentPlace } from '@/lib/document-replica-cache';
import { WRITE_RESPONSE_TIMEOUT_MS } from '@/lib/workspace-service/await-write-response';

export type HeadlessOutcome = 'nothingHeld' | 'synced' | 'stillHeld';

export interface HeadlessSession {
  readonly session: DocumentSession;
  /** Disposes what opening the session loaded (replicas, the runtime). */
  release(): void;
}

export async function syncHeldEdits(nodeId: string, cache: DocumentCache, start: () => Promise<HeadlessSession>, clock: Clock, timeoutMs: number): Promise<HeadlessOutcome> {
  const held: readonly HeldEdits[] = (await cache.loadEdits(nodeId)).filter((h: HeldEdits): boolean => !h.open);
  if (held.length === 0) return 'nothingHeld';
  const { session, release }: HeadlessSession = await start();
  try {
    await session.open();
    await session.save();
    return await acknowledged(session, clock, timeoutMs);
  } finally {
    session.close();
    release();
  }
}

function acknowledged(session: DocumentSession, clock: Clock, timeoutMs: number): Promise<'synced' | 'stillHeld'> {
  return new Promise<'synced' | 'stillHeld'>((resolve: (outcome: 'synced' | 'stillHeld') => void): void => {
    const stops: (() => void)[] = [];
    const done = (outcome: 'synced' | 'stillHeld'): void => {
      for (const stop of stops.splice(0)) stop();
      resolve(outcome);
    };
    const check = (inputs: SaveInputs): void => { if (inputs.unacknowledged === 0) done('synced'); };
    stops.push(session.on('save', check), clock.after(timeoutMs, (): void => done('stillHeld')));
    check(session.saveInputs);
  });
}

/** The app's: this tab's workspace session, the R1 configuration, a write's patience; a chat document on its own log. */
export async function syncHeldEditsHere(place: DocumentPlace): Promise<HeadlessOutcome> {
  const { nodeId, chatDoc } = place;
  let opener: ((from: EditorOrigin) => Promise<EditorSession>) | null = null;
  const opened: EditorSession[] = [];
  const ports: DocumentSessionPorts = workspaceCollabPorts((from: EditorOrigin): Promise<EditorSession> => {
    if (opener === null) throw new Error('the headless session opened a replica before Citadel Docs loaded');
    return opener(from).then((editor: EditorSession): EditorSession => { opened.push(editor); return editor; });
  }, chatDoc);
  if (ports.cache === null) throw new Error('this device keeps no documents, so it holds no edits to send');
  const start = async (): Promise<HeadlessSession> => {
    const runtime: CdocRuntime = await loadCdocRuntime();
    opener = createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => crypto.getRandomValues(b));
    const session: DocumentSession = new DocumentSession({ ...R1_COLLABORATION, nodeId, clientSeqBase: randomClientSeqBase() }, ports);
    return { session, release: (): void => { for (const editor of opened.splice(0)) editor.dispose(); runtime.client.dispose(); } };
  };
  return syncHeldEdits(nodeId, ports.cache, start, browserClock, WRITE_RESPONSE_TIMEOUT_MS);
}
