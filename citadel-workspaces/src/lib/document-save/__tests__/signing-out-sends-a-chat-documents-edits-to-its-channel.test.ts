/**
 * Edits held of a document shared in a node's chat are sent, on sign-out, as that document's:
 * inside the `ChatDocuments` envelope, on the node's id. Its records sit at `<node>/<doc>`, and
 * a sign-out that took that for a page's id sent the page's requests for a node that does not
 * exist, so the edits could never be sent and were offered for deletion instead.
 *
 * Production IO, registry, headless sync, DocumentSession and the in-process cdoc runtime. Stand-ins,
 * each where vitest cannot run the browser's: the IndexedDB Map, the Web Locks set, the runtime's
 * worker hop (inProcessRuntime), and the sender, which records requests instead of writing to
 * the WASM socket. Nothing answers them, so the sync ends held when its wait runs out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentsRequest } from 'citadel-workspace-client-ts';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import type { HeldEditsPrompt } from '../leave-held-edits-prompt';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { createEditorOpener } from '@/lib/cdoc/editor/editor-opener';
import { inProcessRuntime, type TestRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import type { EditorOrigin } from '@/lib/cdoc/editor/controller';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
const sent: WorkspaceProtocolRequestTS[] = vi.hoisted((): WorkspaceProtocolRequestTS[] => []);
const loads: { count: number } = vi.hoisted((): { count: number } => ({ count: 0 }));
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(store));
vi.mock('@/lib/cdoc/collab/instance-locks', async () => ({ browserInstanceLocks: (await import('@/lib/cdoc/collab/__tests__/doubles/memory-device')).memoryLocks }));
vi.mock('@/lib/workspace-service', () => ({
  default: { currentCid: 7n, sendProtocolRequest: (request: WorkspaceProtocolRequestTS): Promise<void> => { sent.push(request); return Promise.resolve(); } },
}));
vi.mock('@/lib/cdoc/runtime-loader', async (): Promise<{ loadCdocRuntime: () => Promise<TestRuntime>; }> => {
  const { inProcessRuntime } = await import('@/lib/cdoc/__tests__/wasm-rig');
  return { loadCdocRuntime: (): Promise<TestRuntime> => { loads.count += 1; return Promise.resolve(inProcessRuntime('main-thread')); } };
});

const { mayLeaveAccountHeldEdits } = await import('../held-edits-io');
const { chatDocumentRecordId, documentEditsKey, localRecordPut } = await import('@/lib/document-replica-cache');
const { requestDocumentSync } = await import('@/lib/document-sync-requests');
const { chatDocumentReplicaKeeper } = await import('@/lib/cdoc/collab/replica-keeper');
// Loaded here, so the sync's own dynamic import of it resolves within the faked clock's turns.
await import('@/lib/cdoc/collab/headless-sync');

const ME: bigint = 7n;
const NODE: string = 'c0ffee00-0000-4000-8000-000000000003';
const DOC: string = 'cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b';

const holdChatEdits = (): Promise<void> => localRecordPut(documentEditsKey(ME, chatDocumentRecordId(NODE, DOC), 'closed-tab'), [Uint8Array.from([1])]);

interface Addressed { readonly chatDoc: string | null; readonly request: string; readonly nodeId: unknown }

/** Each request sent: which chat document's envelope it went in (null: a page's), what it is, and the node it names. */
function addressed(): Addressed[] {
  return sent.map((sentRequest: WorkspaceProtocolRequestTS): Addressed => {
    const envelope: { chat_doc: string; request: DocumentsRequest } | undefined = 'ChatDocuments' in sentRequest ? sentRequest.ChatDocuments : undefined;
    const inner: DocumentsRequest | undefined = envelope?.request ?? ('Documents' in sentRequest ? sentRequest.Documents : undefined);
    const [request, body]: [string, unknown] = inner === undefined ? ['not a documents request', null] : Object.entries(inner)[0];
    return { chatDoc: envelope?.chat_doc ?? null, request, nodeId: (body as { node_id?: unknown } | null)?.node_id };
  });
}

const theChatDocuments = (): Addressed[] => addressed().map((a: Addressed): Addressed => ({ ...a, chatDoc: DOC, nodeId: NODE }));

beforeEach((): void => {
  vi.useFakeTimers();
  store.clear();
  sent.length = 0;
  loads.count = 0;
});
afterEach((): void => { vi.useRealTimers(); });

describe('signing out with edits held of a chat document', () => {
  it('sends them as the chat document\'s, never as a page named <node>/<doc>', async () => {
    await holdChatEdits();
    const asked: string[] = [];
    const confirm = (prompt: HeldEditsPrompt): Promise<boolean> => { asked.push(prompt.confirmLabel); return Promise.resolve(asked.length === 1); };
    const leaving: Promise<boolean> = mayLeaveAccountHeldEdits(ME, true, confirm);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await leaving).toBe(false);
    expect(sent.length).toBeGreaterThan(0);
    expect(addressed()).toEqual(theChatDocuments());
    expect(asked).toEqual(['Sync now', 'Delete and sign out']);
  });

  it('asks a chat document open in this tab to send them, not a second session', async () => {
    await holdChatEdits();
    const runtime: TestRuntime = inProcessRuntime('main-thread');
    const open: (from: EditorOrigin) => Promise<EditorSession> = createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => crypto.getRandomValues(b));
    const close: () => Promise<void> = chatDocumentReplicaKeeper<EditorSession>(NODE, DOC, (): void => undefined)(open, (): void => undefined, (): void => undefined);
    const syncing: Promise<void> = requestDocumentSync({ nodeId: NODE, chatDoc: DOC });
    await vi.advanceTimersByTimeAsync(120_000);
    await syncing;
    expect(loads.count).toBe(0);
    expect(addressed()).toEqual(theChatDocuments());
    expect(addressed().map((a: Addressed): string => a.request)).toContain('Append');
    await close();
    runtime.client.dispose();
  });
});
