/**
 * The shared internal-HTTP frame corpus (apps/catalogue/fixtures/ihttp-frame-cases.json),
 * read with the page's own reader: the CBOR decode and `fromWireFrame` that the relay and P2P
 * ports run on every arriving frame. The kernel's tests read the same file with the wire
 * crate's decoder and the kernel relay, and the expectations are written once, by hand, in
 * the kernel's ihttp_corpus.rs.
 *
 * Only `shape` cases are the page's to judge. A `rules` case (a version, a limit, a path rule,
 * an extra field) is refused by the agent or the kernel, which validate and re-encode every
 * frame before the page sees it, so the page is not asked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCbor, type Decoded } from '../cbor';
import { fromWireFrame, toWireFrame } from '../ihttp-wire';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { IhttpFrame as WireFrame } from '../../sdk/wire-generated/IhttpFrame';

interface CorpusCase { readonly name: string; readonly hex: string; readonly expect: string; readonly layer: 'shape' | 'rules' }

const CORPUS: string = join(process.cwd(), '..', 'apps', 'catalogue', 'fixtures', 'ihttp-frame-cases.json');
const cases: readonly CorpusCase[] = (JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: CorpusCase[] }).cases;

const bytesOf = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (b: string): number => parseInt(b, 16));

/** The page's verdict, in the corpus's words (a refusal of any kind is `refused`). */
function verdict(hex: string): string {
  const decoded: Decoded = decodeCbor(bytesOf(hex));
  const frame: IhttpFrame | null = decoded.ok ? fromWireFrame(decoded.value) : null;
  if (frame === null) return 'refused';
  const kind: WireFrame['kind'] = toWireFrame(frame).kind;
  if (kind === 'End') return 'End';
  if ('Cancel' in kind) return `Cancel(${kind.Cancel.reason})`;
  return Object.keys(kind)[0];
}

describe('the shared frame corpus, through the page reader', () => {
  it('finds the corpus, with cases of both layers', () => {
    // A floor: without it every assertion below passes by matching nothing.
    expect(cases.filter((c: CorpusCase): boolean => c.layer === 'shape').length).toBeGreaterThan(15);
    expect(cases.some((c: CorpusCase): boolean => c.layer === 'rules')).toBe(true);
  });

  it.each(cases.filter((c: CorpusCase): boolean => c.layer === 'shape'))('$name', (c: CorpusCase) => {
    expect(verdict(c.hex)).toBe(c.expect.startsWith('refused:') ? 'refused' : c.expect);
  });
});
