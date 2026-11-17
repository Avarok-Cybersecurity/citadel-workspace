/**
 * The result's `formatting` (docs/edit-commands.md v6): four model values (run and paragraph,
 * effective and direct), two mixed sets as bit fields over RUN_KEYS and PARAGRAPH_KEYS, and the
 * list where the selection starts with whether the selected paragraphs' lists differ.
 * The values are the engine's serde of RunProperties and ParagraphProperties; each is checked
 * to be a map, and its fields are the model's (cdoc-edit is their authority).
 */
import { PARAGRAPH_KEYS, RUN_KEYS, type KnownFormatting, type ListState, type ParagraphKey, type RunKey } from '../caret-formatting';
import { LIST_KINDS } from './encode-command';
import type { ParagraphProperties, RunPropertiesPatch } from '../model-values';
import { isMap, readValue, type CodecValue } from './codec-reader';
import { RecordError } from './record-writer';
import type { RecordReader } from './decode-records';

export function map(bytes: Uint8Array, what: string): { readonly [key: string]: CodecValue } {
  const v: CodecValue = readValue(bytes);
  if (!isMap(v)) throw new RecordError(`${what} is not a map`);
  return v;
}

function keySet<K extends string>(bits: bigint, keys: readonly K[], what: string): ReadonlySet<K> {
  if (bits >> BigInt(keys.length) !== 0n) throw new RecordError(`${what} sets a bit past its last key`);
  return new Set<K>(keys.filter((_: K, i: number) => ((bits >> BigInt(i)) & 1n) === 1n));
}

/** The deepest list level, inclusive (cdoc_model::numbering::MAX_LEVEL). */
const MAX_LIST_LEVEL: number = 8;
/** List kind 6: any definition that is not one of the built-in templates. */
const CUSTOM_LIST: number = LIST_KINDS.length;

/** `list := 0 | 1 kind:u8 level:u8`. */
export function readList(r: RecordReader): ListState | null {
  const present: number = r.u8();
  if (present === 0) return null;
  if (present !== 1) throw new RecordError(`list flag ${present}`);
  const code: number = r.u8();
  const level: number = r.u8();
  const kind: ListState['kind'] | undefined = code === CUSTOM_LIST ? 'custom' : LIST_KINDS[code];
  if (kind === undefined) throw new RecordError(`unknown list kind ${code}`);
  if (level > MAX_LIST_LEVEL) throw new RecordError(`list level ${level} is not 0..=${MAX_LIST_LEVEL}`);
  return { kind, level };
}

function readFlag(r: RecordReader, what: string): boolean {
  const v: number = r.u8();
  if (v > 1) throw new RecordError(`${what} ${v} is not 0 or 1`);
  return v === 1;
}

/** The `formatting` block; the caret's section is read later in the record (decode-result.ts). */
export function readFormatting(r: RecordReader): Omit<KnownFormatting, 'section'> {
  const run: RunPropertiesPatch = map(r.bytesField(), 'run') as RunPropertiesPatch;
  const runDirect: RunPropertiesPatch = map(r.bytesField(), 'run_direct') as RunPropertiesPatch;
  const paragraph: ParagraphProperties = map(r.bytesField(), 'paragraph') as ParagraphProperties;
  const paragraphDirect: ParagraphProperties = map(r.bytesField(), 'paragraph_direct') as ParagraphProperties;
  const runMixed: ReadonlySet<RunKey> = keySet(r.uvBig(), RUN_KEYS, 'run_mixed');
  const paragraphMixed: ReadonlySet<ParagraphKey> = keySet(r.uvBig(), PARAGRAPH_KEYS, 'paragraph_mixed');
  const list: ListState | null = readList(r);
  const listMixed: boolean = readFlag(r, 'list_mixed');
  return { known: true, run, runDirect, paragraph, paragraphDirect, runMixed, paragraphMixed, list, listMixed };
}
