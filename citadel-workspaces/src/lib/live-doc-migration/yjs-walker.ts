/**
 * The old chat editor's stored Yjs state, read with yjs alone, as StarterKit ProseMirror JSON.
 *
 * TipTap's Collaboration extension binds y-prosemirror to `getXmlFragment('default')`: each
 * node is an XmlElement named after its type with its attributes as XML attributes, and each
 * run of text is an XmlText whose delta attributes are the marks (`name` -> mark attrs, or
 * `name--<8-char hash>` for a mark type that may overlap itself). This walks that shape back
 * without y-prosemirror (which needs a ProseMirror schema and a view) and without the editor.
 *
 * Nothing it meets is dropped silently: a shape y-prosemirror never writes (an embed in a
 * text, a bare text at the root) fails the walk, and the migration reports it.
 */
import * as Y from 'yjs';
import { readDocTitle } from '@/lib/live-document-store/doc-title';
import type { PmAttrs, PmMark, PmNode } from './pm-json';

/** The fragment TipTap's Collaboration extension binds to (its `field` default). */
export const TIPTAP_FRAGMENT: 'default' = 'default';

/** y-prosemirror's suffix for a mark type that may overlap itself (sync-plugin.js). */
const HASHED_MARK_NAME: RegExp = /(.*)(--[a-zA-Z0-9+/=]{8})$/;

export class YjsWalkError extends Error {
  constructor(message: string) {
    super(`the stored chat document could not be read: ${message}`);
    this.name = 'YjsWalkError';
  }
}

export interface WalkedDocument {
  /** StarterKit ProseMirror JSON: `{type: 'doc', content}`. */
  readonly pm: PmNode;
  /** The title the document carries (Y.Map `cdoc`), or null when it carries none. */
  readonly title: string | null;
  /** The state's Yjs state vector: what the migration's origin and client id are derived from. */
  readonly stateVector: Uint8Array;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function markOf(name: string, value: unknown): PmMark {
  const type: string = HASHED_MARK_NAME.exec(name)?.[1] ?? name;
  if (value === null || value === undefined) return { type };
  if (!isRecord(value)) throw new YjsWalkError(`mark ${type} carries ${typeof value} attributes`);
  return Object.keys(value).length === 0 ? { type } : { type, attrs: value };
}

function sameMarks(a: readonly PmMark[] | undefined, b: readonly PmMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** y-prosemirror merges neighbouring Y.Texts on read; so does this, so equal runs are one node. */
function pushText(out: PmNode[], text: string, marks: readonly PmMark[]): void {
  if (text.length === 0) return;
  const last: PmNode | undefined = out[out.length - 1];
  if (last?.type === 'text' && sameMarks(last.marks, marks.length > 0 ? marks : undefined)) {
    out[out.length - 1] = { ...last, text: `${last.text ?? ''}${text}` };
    return;
  }
  out.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
}

interface DeltaOp { insert?: unknown; attributes?: Record<string, unknown> }

function textNodes(text: Y.XmlText, out: PmNode[]): void {
  for (const op of text.toDelta() as DeltaOp[]) {
    if (typeof op.insert !== 'string') throw new YjsWalkError('a text holds an embedded object, which the chat editor never wrote');
    const marks: PmMark[] = Object.entries(op.attributes ?? {}).map(([name, value]: [string, unknown]): PmMark => markOf(name, value));
    pushText(out, op.insert, marks);
  }
}

function elementNode(element: Y.XmlElement): PmNode {
  const content: PmNode[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlElement) content.push(elementNode(child));
    else if (child instanceof Y.XmlText) textNodes(child, content);
    else throw new YjsWalkError(`${element.nodeName} holds a ${child.constructor.name}`);
  }
  const attrs: PmAttrs = element.getAttributes();
  return {
    type: element.nodeName,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(content.length > 0 ? { content } : {}),
  };
}

/** Applies `state` to a fresh doc, refusing one whose updates are missing their dependencies. */
export function decodeYjsState(state: Uint8Array): Y.Doc {
  const doc: Y.Doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
  } catch (error) {
    throw new YjsWalkError(error instanceof Error ? error.message : String(error));
  }
  // An update whose dependencies are missing is held as pending, not applied: its text would
  // be absent from the walk, so a partial document would migrate as if it were whole.
  if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) {
    throw new YjsWalkError('the stored state is incomplete (it depends on updates this device never stored)');
  }
  return doc;
}

export function walkYjsDoc(doc: Y.Doc): WalkedDocument {
  const content: PmNode[] = [];
  for (const child of doc.getXmlFragment(TIPTAP_FRAGMENT).toArray()) {
    if (!(child instanceof Y.XmlElement)) throw new YjsWalkError('the document root holds text outside any block');
    content.push(elementNode(child));
  }
  return {
    pm: content.length > 0 ? { type: 'doc', content } : { type: 'doc' },
    title: readDocTitle(doc),
    stateVector: Y.encodeStateVector(doc),
  };
}

export function walkYjsState(state: Uint8Array): WalkedDocument {
  const doc: Y.Doc = decodeYjsState(state);
  try {
    return walkYjsDoc(doc);
  } finally {
    doc.destroy();
  }
}
