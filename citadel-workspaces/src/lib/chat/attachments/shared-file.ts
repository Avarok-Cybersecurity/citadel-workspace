/**
 * A file shared in a node's chat, as its message names it and its bubble shows it. Pure.
 */
import type { GroupMessageType } from 'citadel-workspace-client-ts';

export interface SharedFile {
  /** The SHA-256 of its bytes, which the server keeps it under at the node. */
  readonly id: string;
  /** The sender's name for it: shown, and sanitised before it names a download. */
  readonly name: string;
  readonly size: number;
  /** The sender's declared type: a hint for the icon, never how its bytes are opened. */
  readonly mime: string;
}

/** What a `FileShare` message carries. */
export type FileShareFields = Extract<GroupMessageType, { FileShare: unknown }>['FileShare'];

/** The file a `FileShare` message shares. */
export function sharedFile({ attachment_id, name, size_bytes, mime }: FileShareFields): SharedFile {
  return { id: attachment_id, name, size: Number(size_bytes), mime };
}

/** The type a picked file is shared as: what the browser says, or opaque bytes when it says nothing usable. */
export function declaredMime(type: string): string {
  return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(type) ? type : 'application/octet-stream';
}
