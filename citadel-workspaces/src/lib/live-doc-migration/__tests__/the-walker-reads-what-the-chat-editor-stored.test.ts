/**
 * The walker, over what the earlier chat editor really stored: StarterKit documents written by
 * y-prosemirror, one by a real TipTap editor with the chat's own extension set, and the seeded
 * "turn this message into a document" shape, recorded while that editor was in the app
 * (fixtures.ts), read back with yjs alone.
 *
 * The oracle is y-prosemirror's own reader, recorded with each document: the walk must match
 * what the editor showed. (The editor's packages are gone, so the schema can no longer be asked;
 * the recording is what it answered.)
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { walkYjsDoc, walkYjsState, YjsWalkError, TIPTAP_FRAGMENT, type WalkedDocument } from '../yjs-walker';
import { plainTextOf, type PmNode } from '../pm-json';
import { chatYDoc, recordedShown, recordedUpdate, type RecordedName } from './fixtures';

const text = (t: string, marks?: PmNode['marks']): PmNode => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content: PmNode[]): PmNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const doc = (...content: PmNode[]): PmNode => ({ type: 'doc', content });

const SHAPES: readonly RecordedName[] = ['headings', 'nestedLists', 'marks', 'blocks', 'empty', 'emptyParagraphs', 'unicodeRtl'];

const roundTrip = (name: RecordedName): WalkedDocument => walkYjsState(recordedUpdate(name));

describe('the walker reads every StarterKit shape the chat editor stored', () => {
  for (const name of SHAPES) {
    it(`${name}: what y-prosemirror itself read from the same state`, () => {
      expect(roundTrip(name).pm).toEqual(recordedShown(name));
    });
  }

  it('reads a document a real TipTap editor wrote through the chat’s own extensions', () => {
    expect(roundTrip('realEditor').pm).toEqual(recordedShown('realEditor'));
  });

  it('reads the seeded "turn this message into a document" shape', () => {
    expect(roundTrip('seeded').pm).toEqual(doc(para(text('first')), para(), para(text('third'))));
    expect(roundTrip('seeded').pm).toEqual(recordedShown('seeded'));
  });

  it('carries the title from the document’s attributes map, and null when it has none', () => {
    expect(walkYjsState(Y.encodeStateAsUpdate(chatYDoc('headings', 'Quarterly plan'))).title).toBe('Quarterly plan');
    expect(roundTrip('headings').title).toBeNull();
  });

  it('keeps a large document whole, in bounded time', () => {
    // 3000 copies of the chat editor's own marked paragraph.
    const written: Y.XmlElement = chatYDoc('marks', null).getXmlFragment(TIPTAP_FRAGMENT).get(0) as Y.XmlElement;
    const large: Y.Doc = new Y.Doc();
    large.getXmlFragment(TIPTAP_FRAGMENT).insert(0, Array.from({ length: 3000 }, (): Y.XmlElement => written.clone()));
    const started: number = performance.now();
    const walked: WalkedDocument = walkYjsState(Y.encodeStateAsUpdate(large));
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(walked.pm.content).toHaveLength(3000);
    const shown: PmNode | undefined = recordedShown('marks').content?.[0];
    expect(walked.pm.content?.every((paragraph: PmNode): boolean => JSON.stringify(paragraph) === JSON.stringify(walked.pm.content?.[0]))).toBe(true);
    expect(walked.pm.content?.[0]).toEqual(shown);
  });

  it('merges neighbouring runs with the same marks, as y-prosemirror does on read', () => {
    const ydoc: Y.Doc = new Y.Doc();
    const paragraph: Y.XmlElement = new Y.XmlElement('paragraph');
    ydoc.getXmlFragment(TIPTAP_FRAGMENT).insert(0, [paragraph]);
    paragraph.insert(0, [new Y.XmlText('ab'), new Y.XmlText('cd')]);
    expect(walkYjsDoc(ydoc).pm).toEqual(doc(para(text('abcd'))));
  });

  it('reads a hashed mark name (a self-overlapping mark) as its type', () => {
    const ydoc: Y.Doc = new Y.Doc();
    const paragraph: Y.XmlElement = new Y.XmlElement('paragraph');
    ydoc.getXmlFragment(TIPTAP_FRAGMENT).insert(0, [paragraph]);
    const run: Y.XmlText = new Y.XmlText();
    paragraph.insert(0, [run]);
    run.insert(0, 'note', { 'comment--abcd1234': { id: 7 } });
    expect(walkYjsDoc(ydoc).pm).toEqual(doc(para(text('note', [{ type: 'comment', attrs: { id: 7 } }]))));
  });
});

describe('the walker refuses what it cannot read faithfully', () => {
  it('refuses a state whose updates depend on updates never stored', () => {
    const source: Y.Doc = chatYDoc('marks', null);
    const before: Uint8Array = Y.encodeStateVector(source);
    source.getXmlFragment(TIPTAP_FRAGMENT).insert(1, [new Y.XmlElement('paragraph')]);
    const onlyTheLaterEdit: Uint8Array = Y.encodeStateAsUpdate(source, before);
    expect(() => walkYjsState(onlyTheLaterEdit)).toThrow(YjsWalkError);
    // Control: the same edit with its history reads fine.
    expect(() => walkYjsState(Y.encodeStateAsUpdate(source))).not.toThrow();
  });

  it('refuses bytes that are not a Yjs update', () => {
    expect(() => walkYjsState(new Uint8Array([1, 2, 3, 250, 251]))).toThrow(YjsWalkError);
  });

  it('refuses an embedded object in a text, which the chat editor never wrote', () => {
    const ydoc: Y.Doc = new Y.Doc();
    const paragraph: Y.XmlElement = new Y.XmlElement('paragraph');
    ydoc.getXmlFragment(TIPTAP_FRAGMENT).insert(0, [paragraph]);
    const run: Y.XmlText = new Y.XmlText('ok');
    paragraph.insert(0, [run]);
    run.insertEmbed(1, { image: 'x' });
    expect(() => walkYjsDoc(ydoc)).toThrow(YjsWalkError);
  });

  it('refuses text at the root, outside any block', () => {
    const ydoc: Y.Doc = new Y.Doc();
    ydoc.getXmlFragment(TIPTAP_FRAGMENT).insert(0, [new Y.XmlText('loose')]);
    expect(() => walkYjsDoc(ydoc)).toThrow(YjsWalkError);
  });
});

describe('the original as text', () => {
  it('keeps every word, a block per line, lists and quotes marked', () => {
    expect(plainTextOf(roundTrip('nestedLists').pm)).toBe('- a\n  3. a.3\n     - deep\n- b');
    expect(plainTextOf(roundTrip('blocks').pm)).toBe('> quoted\n> twice\nfn main() {}\n  // two lines\n---\nline\nbreak');
    expect(plainTextOf(roundTrip('unicodeRtl').pm)).toContain('שלום עולם — مرحبا بالعالم');
  });
});
