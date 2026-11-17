/**
 * Where the file manager is, as the URL says it: whose storage, which folder,
 * and which item a shared link points at.
 *
 *   /workspace?section=files&peer_id=<cid|server>&path=/x[&item=name][&via=<cid>]
 *
 * No `peer_id` means the server, no `path` means the top level. An id that is
 * neither `server` nor a CID stays unreadable -- the screen says so -- rather
 * than becoming some other storage: opening the wrong member's files because a
 * link was mistyped is the defect this replaces.
 *
 * `via` is the CID of whoever copied a PEER link. Peer storage belongs to a
 * pair, so the person a link is most likely sent to is the other half of that
 * pair, and for them `peer_id` names themselves. `resolveStorage` turns that
 * into the storage they share with the sender.
 */
import { normalizePath } from '@/lib/revfs/tree-queries';
import {
  FILE_MANAGER_SECTION, buildWorkspacePath, enterSection, getWorkspacePath,
} from '@/lib/workspace-navigation';

export const SERVER_PEER_ID = 'server' as const;

export type StorageRef =
  | { kind: 'server' }
  | { kind: 'peer'; cid: bigint }
  | { kind: 'invalid'; raw: string };

export interface FileManagerLocation {
  storage: StorageRef;
  path: string;
  item: string | null;
  via: bigint | null;
}

/** A place the file manager can be sent to: an unreadable storage is never a destination. */
export interface FileManagerTarget {
  storage: Exclude<StorageRef, { kind: 'invalid' }>;
  path: string;
  item: string | null;
  via: bigint | null;
}

const CID_PATTERN: RegExp = /^\d+$/;

function readCid(raw: string | null): bigint | null {
  if (raw === null || !CID_PATTERN.test(raw)) return null;
  const cid: bigint = BigInt(raw);
  return cid === 0n ? null : cid;
}

function readStorage(raw: string | null): StorageRef {
  if (raw === null || raw === SERVER_PEER_ID) return { kind: 'server' };
  const cid: bigint | null = readCid(raw);
  return cid === null ? { kind: 'invalid', raw } : { kind: 'peer', cid };
}

export function parseFileManagerLocation(params: URLSearchParams): FileManagerLocation {
  const item: string | null = params.get('item');
  return {
    storage: readStorage(params.get('peer_id')),
    path: normalizePath(params.get('path') ?? '/'),
    item: item === '' ? null : item,
    via: readCid(params.get('via')),
  };
}

/** The storage this viewer means: a peer link opened by that peer is their storage with the sender. */
export function resolveStorage(location: FileManagerLocation, myCid: bigint | null): StorageRef {
  const { storage, via } = location;
  if (storage.kind === 'peer' && via !== null && myCid !== null && storage.cid === myCid && via !== myCid) {
    return { kind: 'peer', cid: via };
  }
  return storage;
}

function writeTarget(params: URLSearchParams, target: FileManagerTarget): void {
  enterSection(params, FILE_MANAGER_SECTION);
  params.set('peer_id', target.storage.kind === 'server' ? SERVER_PEER_ID : target.storage.cid.toString());
  params.set('path', normalizePath(target.path));
  if (target.item === null) params.delete('item'); else params.set('item', target.item);
  if (target.via === null) params.delete('via'); else params.set('via', target.via.toString());
}

/** The in-app route to `target`, keeping the caller's unrelated parameters. */
export function fileManagerHref(search: string, target: FileManagerTarget): string {
  const params: URLSearchParams = new URLSearchParams(search);
  writeTarget(params, target);
  return buildWorkspacePath(params);
}

/** An absolute link to `target`, carrying nothing but the file manager's own keys. */
export function fileManagerLink(origin: string, target: FileManagerTarget): string {
  const params: URLSearchParams = new URLSearchParams();
  writeTarget(params, target);
  return `${origin}${getWorkspacePath(Object.fromEntries(params))}`;
}
