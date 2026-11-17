/**
 * The records cdoc-edit's v4 session calls return (docs/edit-commands.md): the "CDK" chunks of
 * encodeDiffChunked, the "CDS" style sheet and the "CDB" image the canvas painter draws. Each is
 * read to its end, and
 * every count is checked against the bytes left before anything is sized by it.
 */
import type { ParagraphProperties, RunPropertiesPatch } from '../model-values';
import { RecordReader } from './decode-records';
import { map } from './decode-formatting';
import { RecordError } from './record-writer';

export interface DocumentStyle {
  readonly id: string;
  readonly name: string;
  readonly kind: 'paragraph' | 'character' | 'table';
  readonly basedOn: string | null;
  /** What the style resolves to through its based-on chain and the document defaults. */
  readonly run: RunPropertiesPatch;
  readonly paragraph: ParagraphProperties;
}

export interface HeldImage {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** Updates to apply in order, each a complete cdoc-crdt update of at most the requested size. */
export function decodeChunks(bytes: Uint8Array): Uint8Array[] {
  const r: RecordReader = new RecordReader(bytes);
  r.magic('CDK', 1);
  const updates: Uint8Array[] = Array.from({ length: r.count(1, 'the chunks') }, (): Uint8Array => r.bytesField());
  r.end();
  return updates;
}

const STYLE_KINDS: readonly DocumentStyle['kind'][] = ['paragraph', 'character', 'table'];

export function decodeStyles(bytes: Uint8Array): DocumentStyle[] {
  const r: RecordReader = new RecordReader(bytes);
  r.magic('CDS', 1);
  const styles: DocumentStyle[] = Array.from({ length: r.count(5, 'the styles') }, (): DocumentStyle => {
    const id: string = r.str();
    const name: string = r.str();
    const kind: DocumentStyle['kind'] | undefined = STYLE_KINDS[r.u8()];
    if (kind === undefined) throw new RecordError('unknown style kind');
    const tag: number = r.u8();
    if (tag !== 0 && tag !== 1) throw new RecordError(`based-on tag ${tag}`);
    const basedOn: string | null = tag === 1 ? r.str() : null;
    // The model's serde shapes; cdoc-edit is their authority.
    const run: RunPropertiesPatch = map(r.bytesField(), 'style run') as RunPropertiesPatch;
    const paragraph: ParagraphProperties = map(r.bytesField(), 'style paragraph') as ParagraphProperties;
    return { id, name, kind, basedOn, run, paragraph };
  });
  r.end();
  return styles;
}

export function decodeImage(bytes: Uint8Array): HeldImage {
  const r: RecordReader = new RecordReader(bytes);
  r.magic('CDB', 1);
  const mime: string = r.str();
  const image: Uint8Array = r.bytesField();
  r.end();
  return { mime, bytes: image };
}
