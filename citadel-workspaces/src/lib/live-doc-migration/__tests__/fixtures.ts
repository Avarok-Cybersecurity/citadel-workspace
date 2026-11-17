/**
 * Real chat documents: the Yjs state the earlier chat editor wrote, recorded while that editor
 * was still in the app (recorded/chat-editor-documents.json, written on 2026-10-22 by
 * y-prosemirror 1.3.7's prosemirrorJSONToYDoc against TipTap 2.27.2's StarterKit schema, by a
 * TipTap Editor running the chat's own extension set, and by the "turn this message into a
 * document" seed), each with what y-prosemirror itself read back from it: the oracle. Stored
 * exactly as the live-document store stored them. And the mapper stand-in, a test double for
 * the engine's StarterKit importer (see mapper-port.ts).
 */
import * as Y from 'yjs';
import { DOC_ATTRIBUTES_MAP, DOC_TITLE_KEY } from '@/lib/live-document-store/doc-title';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import type { StoredDocument } from '@/lib/live-document-store/types';
import type { PmNode } from '../pm-json';
import type { MappedSnapshot, MapperLoader, MigrationMapper } from '../mapper-port';
import type { FakeLocalDb } from './fake-local-db';
import RECORDED from './recorded/chat-editor-documents.json';

export type RecordedName = keyof typeof RECORDED;

/** The bytes the chat editor stored for `name`. */
export const recordedUpdate = (name: RecordedName): Uint8Array => Uint8Array.from(atob(RECORDED[name].update), (c: string): number => c.charCodeAt(0));

/** Drops the null attributes ProseMirror fills in for a schema default; y-prosemirror stores none. */
function withoutSchemaNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSchemaNulls);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key !== 'attrs' || inner === null || typeof inner !== 'object') {
      out[key] = withoutSchemaNulls(inner);
      continue;
    }
    const kept: [string, unknown][] = Object.entries(inner).filter(([, attr]: [string, unknown]): boolean => attr !== null);
    if (kept.length > 0) out[key] = Object.fromEntries(kept);
  }
  return out;
}

/**
 * What the chat editor showed for `name`, as y-prosemirror read it back, less the attributes
 * ProseMirror's schema defaulted to null: those are the schema's, not the document's.
 */
export const recordedShown = (name: RecordedName): PmNode => withoutSchemaNulls(RECORDED[name].shown) as PmNode;

/** The Y.Doc the chat editor held for `name`, with `title` in its attributes map when given. */
export function chatYDoc(name: RecordedName, title: string | null): Y.Doc {
  const doc: Y.Doc = new Y.Doc();
  Y.applyUpdate(doc, recordedUpdate(name));
  if (title !== null) doc.getMap(DOC_ATTRIBUTES_MAP).set(DOC_TITLE_KEY, title);
  return doc;
}

export interface Participants {
  readonly holder: bigint;
  readonly peer: bigint;
}

/** Stores `doc` under cid 0 as the live-document store did (JSON of its metadata and Yjs state). */
export function storeOriginal(db: FakeLocalDb, docId: string, doc: Y.Doc, who: Participants, title: string): StoredDocument {
  const now: number = 1_700_000_000_000;
  const stored: StoredDocument = {
    metadata: { id: docId, title, peerCid: who.peer.toString(), creatorCid: who.holder.toString(), createdAt: now, updatedAt: now, revision: 0 },
    state: Array.from(Y.encodeStateAsUpdate(doc)),
  };
  db.seed(0n, `live_doc_${docId}`, stringToBytes(JSON.stringify(stored)));
  return stored;
}

export function storeIndex(db: FakeLocalDb, ids: readonly string[]): void {
  db.seed(0n, 'live_doc_index', stringToBytes(JSON.stringify(ids)));
}

export const LOSSLESS_REPORT: string = JSON.stringify({ report: { losses: [] }, problems: [] });

/**
 * Deterministic in its inputs, as the engine's importer must be: the snapshot is the client id
 * and the JSON it was handed, so equal bytes prove the runner handed it equal inputs.
 */
export const echoMapper: MigrationMapper = {
  toSnapshot: (json: string, client: bigint): MappedSnapshot => ({ snapshot: new TextEncoder().encode(`${client.toString()}|${json}`), reportJson: LOSSLESS_REPORT }),
  toDocsPm: (json: string): string => JSON.stringify({ type: 'doc', from: JSON.parse(json) as unknown }),
};

export const loaderOf = (mapper: MigrationMapper | null): MapperLoader => (): Promise<MigrationMapper | null> => Promise.resolve(mapper);

/** The document most tests move: a heading, and a paragraph with a bold run. */
export const STARTER_KIT_SAMPLE: RecordedName = 'sample';
