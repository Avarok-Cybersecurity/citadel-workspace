/**
 * The two sections version 5 and 6 append to the "CDE" result record (docs/edit-commands.md):
 * `remote`, what an applyRemote left waiting, and `story`, the story the selection is in.
 */
import type { Story } from '../editor-commands';
import type { RecordReader } from './decode-records';
import { FURNITURE, HEADER_FOOTER_KINDS } from './encode-command';
import { RecordError } from './record-writer';

/** The first unit the buffered operations wait for: a CRDT client and clock. */
export interface MissingUnit {
  readonly client: bigint;
  readonly clock: bigint;
}

/**
 * What an applied remote update left waiting: the unit its buffered operations need (ask the
 * peer for a diff against this replica's state vector when it is set), and how many waiting
 * operations the pending limits dropped. Both empty: nothing waits.
 */
export interface RemoteReport {
  readonly missing: MissingUnit | null;
  readonly dropped: bigint;
}

/** `remote := 0 | 1 missing:(0 | 1 client:uv clock:uv) dropped:uv`; null for a request's result. */
export function readRemote(r: RecordReader): RemoteReport | null {
  const present: number = r.u8();
  if (present === 0) return null;
  if (present !== 1) throw new RecordError(`remote flag ${present}`);
  const has: number = r.u8();
  if (has > 1) throw new RecordError(`missing flag ${has}`);
  const missing: MissingUnit | null = has === 1 ? { client: r.uvBig(), clock: r.uvBig() } : null;
  return { missing, dropped: r.uvBig() };
}

/** `story := 0 | 1 section:uv kind:u8 | 2 section:uv kind:u8 | 3 id:uv`. */
export function readStory(r: RecordReader): Story {
  const tag: number = r.u8();
  if (tag === 0) return { kind: 'body' };
  if (tag === 3) return { kind: 'footnote', id: r.uv() };
  const kind: Story['kind'] | undefined = FURNITURE[tag - 1];
  if (kind === undefined) throw new RecordError(`unknown story ${tag}`);
  const section: number = r.uv();
  const code: number = r.u8();
  const which: (typeof HEADER_FOOTER_KINDS)[number] | undefined = HEADER_FOOTER_KINDS[code];
  if (which === undefined) throw new RecordError(`unknown header or footer kind ${code}`);
  return { kind, section, which };
}
