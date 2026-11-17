/**
 * A `CARET_LINES` payload (`docs/display-list.md` v5 § CARET_LINES), checked and counted: a
 * page's lines of document text with where each came from, for an editor. Nothing here paints
 * them and the editor maps carets through cdoc-edit, so only the invariants are kept: at least
 * one line, known heads, regions and kinds, the first line naming its paragraph, a line with no
 * runs having a stop, gaps strictly increasing.
 */
import { LINE_NEW, LINE_NO_STOPS, LINE_SAME_HEIGHT, LINE_SAME_PITCH } from '../format';
import { DisplayListError, type ByteReader } from './byte-reader';
import type { Op } from './types';

const REGION_HEADER: number = 1;
const REGION_FOOTER: number = 2;
const REGION_FOOTNOTE: number = 3;
/** Header and footer kinds: default, first page, even pages. */
const KINDS: number = 3;
const HEADS: number = LINE_NEW | LINE_SAME_PITCH | LINE_SAME_HEIGHT | LINE_NO_STOPS;

/** A new paragraph's region (0 body, 1 header, 2 footer, 3 footnote), its section or footnote id, and its path. */
function provenance(r: ByteReader): void {
  const region: number = r.u8();
  if (region > REGION_FOOTNOTE) throw new DisplayListError(`unknown caret line region ${region}`);
  r.uv();
  if ((region === REGION_HEADER || region === REGION_FOOTER) && r.u8() >= KINDS) throw new DisplayListError('unknown header or footer kind');
  // Each block index is at least one byte.
  const depth: number = r.count(1, 'a caret line path');
  for (let k: number = 0; k < depth; k++) r.uv();
}

export function caretLines(r: ByteReader): Extract<Op, { kind: 'caretLines' }> {
  // A line is at least its head and its run count.
  const lines: number = r.count(2, 'a caret lines op');
  if (lines === 0) throw new DisplayListError('a caret lines op has no lines');
  for (let i: number = 0; i < lines; i++) {
    const head: number = r.u8();
    if ((head & ~HEADS) !== 0) throw new DisplayListError('unknown caret line head');
    if ((head & LINE_NEW) !== 0) provenance(r);
    else if (i === 0) throw new DisplayListError('the first caret line names no paragraph');
    if ((head & LINE_SAME_PITCH) === 0) r.zz();
    if ((head & LINE_SAME_HEIGHT) === 0) r.zz();
    const runs: number = r.uv();
    // A stop is at least its gap and its x.
    const stops: number = (head & LINE_NO_STOPS) === 0 ? r.count(2, 'a caret line') : 0;
    if (runs === 0 && stops === 0) throw new DisplayListError('a caret line has no runs and no stops');
    let last: number = -1;
    for (let k: number = 0; k < stops; k++) {
      const gap: number = r.uv();
      r.zz();
      if (gap <= last) throw new DisplayListError("caret stops' gaps do not increase");
      last = gap;
    }
  }
  return { kind: 'caretLines', lines };
}
