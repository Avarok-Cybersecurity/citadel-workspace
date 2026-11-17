/**
 * The editor contract the ribbons and collaboration build against. The opcode table below is
 * transcribed from citadel-docs docs/edit-commands.md (v4, main b5cd990) as the oracle, so a typo in
 * COMMAND_OPCODES, or a command added without its documented opcode, fails here rather than as
 * an engine error on a key press. 0x25 and 0x26 are cdoc-edit's InsertFootnote(None) and
 * InsertImage { size: None }: records of their own, so commands of their own here.
 */
import { describe, expect, it } from 'vitest';
import { COMMAND_OPCODES, type EditorCommandName } from '../controller';
import { EDITOR_KINDS, type EditorKind } from '../../worker/editor-protocol';

const DOCUMENTED: ReadonlyArray<readonly [number, string]> = [
  [0x01, 'InsertText'], [0x02, 'DeleteBackward'], [0x03, 'DeleteForward'], [0x04, 'SplitParagraph'],
  [0x05, 'InsertBreak'], [0x06, 'InsertTab'], [0x07, 'ToggleMark'], [0x08, 'SetRunProperty'],
  [0x09, 'SetParagraphProperty'], [0x0a, 'SetParagraphStyle'], [0x0b, 'SetNumbering'], [0x0c, 'ClearNumbering'], [0x19, 'SetNumberingKind'],
  [0x0d, 'Indent'], [0x0e, 'Outdent'], [0x0f, 'SetSectionProperty'], [0x10, 'InsertTable'], [0x11, 'InsertRowAbove'], [0x12, 'InsertRowBelow'],
  [0x13, 'InsertColumnLeft'], [0x14, 'InsertColumnRight'], [0x15, 'DeleteRow'], [0x16, 'DeleteColumn'],
  [0x17, 'DeleteTable'], [0x18, 'MergeCells'], [0x20, 'InsertImage'], [0x21, 'InsertFootnote'], [0x25, 'InsertNewFootnote'], [0x26, 'InsertImageFitted'], [0x22, 'InsertLink'],
  [0x23, 'RemoveLink'], [0x24, 'InsertComment'], [0x30, 'Replace'], [0x31, 'SelectAll'], [0x32, 'SetSelection'], [0x33, 'Cut'],
  [0x34, 'EditHeaderFooter'], [0x35, 'GoToFootnote'], [0x36, 'ReturnToBody'],
  [0x40, 'Undo'], [0x41, 'Redo'], [0x42, 'BreakUndoGroup'], [0x43, 'MoveCaret'], [0x44, 'SelectWord'],
  [0x45, 'SelectParagraph'], [0x50, 'CompositionStart'], [0x51, 'CompositionUpdate'], [0x52, 'CompositionCommit'],
  [0x53, 'CompositionCancel'],
];

const camel = (pascal: string): string => pascal.charAt(0).toLowerCase() + pascal.slice(1);

describe('the editor command contract', () => {
  it('gives every command exactly its documented opcode, and documents every command', () => {
    const expected: Record<string, number> = Object.fromEntries(DOCUMENTED.map(([op, name]) => [camel(name), op]));
    expect({ ...COMMAND_OPCODES }).toEqual(expected);
  });

  it('never gives two commands one opcode', () => {
    const ops: number[] = Object.values(COMMAND_OPCODES);
    expect(new Set(ops).size).toBe(ops.length);
  });

  it('names every command in camelCase of its record name', () => {
    const names: EditorCommandName[] = Object.keys(COMMAND_OPCODES) as EditorCommandName[];
    expect(names.every((n: string) => /^[a-z][A-Za-z]+$/.test(n))).toBe(true);
  });
});

describe('the editor worker kinds', () => {
  // Exhaustive at compile time: a kind added to EditorRequestBody is a type error here.
  const EVERY: { readonly [K in EditorKind]: K } = {
    editorOpen: 'editorOpen', apply: 'apply', applyRemote: 'applyRemote', hitTest: 'hitTest',
    snapshot: 'snapshot', awareness: 'awareness', peerView: 'peerView', pageSizes: 'pageSizes', invalidatePages: 'invalidatePages', stateVector: 'stateVector', encodeDiff: 'encodeDiff', encodeDiffChunked: 'encodeDiffChunked', gc: 'gc', addImage: 'addImage', selectionText: 'selectionText', styles: 'styles', image: 'image', exportAs: 'exportAs', missingPatterns: 'missingPatterns',
  };

  it('lists each kind once', () => {
    expect([...EDITOR_KINDS].sort()).toEqual(Object.keys(EVERY).sort());
    expect(new Set(EDITOR_KINDS).size).toBe(EDITOR_KINDS.length);
  });
});
