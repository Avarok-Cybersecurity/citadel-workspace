/**
 * Decodes one page body (`docs/display-list.md` v5 § Page body, § Operations), checking every
 * invariant the spec lists for a body: known opcodes, payloads consumed exactly, strike and
 * string indices in range, glyph runs (glyph-run.ts) and caret lines (caret-lines.ts) well
 * formed, clip pushes and pops balanced.
 */
import {
  OP_CARET_LINES, OP_CLIP_POP, OP_CLIP_PUSH, OP_FILL_PATH, OP_FILL_RECT, OP_GLYPH_RUN, OP_IMAGE, OP_LINE, OP_LINK,
  OP_SIG_FIELD, OP_STROKE_PATH, OP_STROKE_RECT, SEG_CLOSE, SEG_CUBIC, SEG_LINE, SEG_MOVE,
} from '../format';
import { ByteReader, DisplayListError } from './byte-reader';
import { glyphRun } from './glyph-run';
import { caretLines } from './caret-lines';
import type { DisplayList, Op, PageEntry, PageOps, PathData, Rect } from './types';

const POINTS_PER_VERB: ReadonlyMap<number, number> = new Map<number, number>([
  [SEG_MOVE, 1], [SEG_LINE, 1], [SEG_CUBIC, 3], [SEG_CLOSE, 0],
]);

function rect(r: ByteReader): Rect {
  return { x: r.zz(), y: r.zz(), w: r.zz(), h: r.zz() };
}

function path(r: ByteReader): PathData {
  const count: number = r.count(1, 'a path');
  const verbs: Uint8Array = new Uint8Array(count);
  const coords: number[] = [];
  for (let i: number = 0; i < count; i++) {
    const verb: number = r.u8();
    const points: number | undefined = POINTS_PER_VERB.get(verb);
    if (points === undefined) throw new DisplayListError(`unknown path verb ${verb}`);
    verbs[i] = verb;
    for (let p: number = 0; p < points * 2; p++) coords.push(r.zz());
  }
  return { verbs, coords: Int32Array.from(coords) };
}

export function stringAt(strings: readonly string[], index: number): string {
  const value: string | undefined = strings[index];
  if (value === undefined) throw new DisplayListError(`string index ${index} is past the string table`);
  return value;
}

function string(r: ByteReader, list: DisplayList): string {
  return stringAt(list.strings, r.uv());
}

function op(code: number, r: ByteReader, list: DisplayList): Op {
  switch (code) {
    case OP_FILL_RECT: return { kind: 'fillRect', rect: rect(r), color: r.rgba() };
    case OP_STROKE_RECT: return { kind: 'strokeRect', rect: rect(r), width: r.zz(), color: r.rgba() };
    case OP_LINE: return { kind: 'line', x1: r.zz(), y1: r.zz(), x2: r.zz(), y2: r.zz(), width: r.zz(), color: r.rgba() };
    case OP_FILL_PATH: return { kind: 'fillPath', color: r.rgba(), path: path(r) };
    case OP_STROKE_PATH: return { kind: 'strokePath', width: r.zz(), color: r.rgba(), path: path(r) };
    case OP_GLYPH_RUN: return glyphRun(r, list);
    case OP_IMAGE: return { kind: 'image', rect: rect(r), contentId: string(r, list) };
    case OP_LINK: return { kind: 'link', rect: rect(r), target: string(r, list) };
    case OP_SIG_FIELD: return { kind: 'sigField', rect: rect(r), fieldId: string(r, list), role: string(r, list) };
    case OP_CLIP_PUSH: return { kind: 'clipPush', rect: rect(r) };
    case OP_CLIP_POP: return { kind: 'clipPop' };
    case OP_CARET_LINES: return caretLines(r);
    default: throw new DisplayListError(`unknown opcode 0x${code.toString(16).padStart(2, '0')}`);
  }
}

/** Decodes the page in `slot` (its position in the list, not its page number). */
export function decodePage(list: DisplayList, slot: number): PageOps {
  const entry: PageEntry | undefined = list.pages[slot];
  if (entry === undefined) throw new DisplayListError(`no page slot ${slot}`);
  const end: number = entry.offset + entry.length;
  if (end > list.view.byteLength) throw new DisplayListError(`page slot ${slot} is truncated at byte ${list.view.byteLength}`);
  const body: ByteReader = new ByteReader(list.view, entry.offset, end);
  const ops: Op[] = [];
  let clips: number = 0;
  while (!body.done) {
    const code: number = body.u8();
    const len: number = body.uv();
    const payloadEnd: number = body.pos + len;
    if (payloadEnd > end) throw new DisplayListError(`payload of op ${ops.length} runs past page slot ${slot}`);
    const payload: ByteReader = new ByteReader(list.view, body.pos, payloadEnd);
    const decoded: Op = op(code, payload, list);
    if (!payload.done) throw new DisplayListError(`payload of op ${ops.length} is longer than its fields`);
    if (decoded.kind === 'clipPush') clips++;
    if (decoded.kind === 'clipPop' && --clips < 0) throw new DisplayListError(`clip pop without a push on page slot ${slot}`);
    ops.push(decoded);
    body.pos = payloadEnd;
  }
  if (clips !== 0) throw new DisplayListError(`page slot ${slot} ends with ${clips} clip(s) open`);
  return { entry, ops };
}
