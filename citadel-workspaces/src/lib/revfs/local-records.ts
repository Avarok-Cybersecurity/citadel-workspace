/**
 * "Sent Files" and "Received Files": this account's record of chat transfers.
 *
 * They live in the peer-pair tree so the file manager can show them, but they
 * are not shared storage. A Sent entry on one side is a Received entry on the
 * other, and each side writes its own. So they never travel: a PlaceFile under
 * /Sent Files, or a SyncResponse carrying them, would plant the peer's sends in
 * our Sent Files (the union merge keeps Sent as Sent) -- files we never sent.
 */
import { RECEIVED_FILES_DIR, SENT_FILES_DIR, type RevfsNode } from '@/types/revfs-types';
import { cloneTree } from './tree-operations';

const RECORD_DIRS: ReadonlySet<string> = new Set([SENT_FILES_DIR, RECEIVED_FILES_DIR]);

/** A copy of `tree` with the record folders present but empty. */
export function withoutLocalRecords(tree: RevfsNode): RevfsNode {
  const copy: RevfsNode = cloneTree(tree);
  for (const child of copy.children ?? []) {
    if (RECORD_DIRS.has(child.path)) child.children = [];
  }
  return copy;
}

function splitName(fileName: string): [string, string] {
  const dot: number = fileName.lastIndexOf('.');
  return dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ''];
}

/**
 * Where to record transfer `transferId` named `fileName` in a record folder
 * holding `existing`, or null when it is already recorded.
 *
 * Null for a repeat because completion can be reported more than once (the
 * tick stream and a status notification can both close a transfer). A
 * DIFFERENT transfer with the same name gets "name (2).ext": placing it at the
 * same path replaces the node, which silently erased the earlier file's record.
 */
export function recordPathFor(
  dir: string,
  fileName: string,
  transferId: string,
  existing: readonly RevfsNode[],
): string | null {
  if (existing.some((n) => n.fileMetadata?.fileId === transferId)) return null;
  const taken: Set<string> = new Set(existing.map((n) => n.name));
  const [stem, ext] = splitName(fileName);
  let candidate: string = fileName;
  for (let n: number = 2; taken.has(candidate); n += 1) candidate = `${stem} (${n})${ext}`;
  return `${dir}/${candidate}`;
}
