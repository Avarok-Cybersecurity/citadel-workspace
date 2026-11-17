/**
 * Whether the open storage takes files: an answer, never a default. A server's storage is not
 * known until GetServerCapabilities answers, and until then nothing offers it; a peer's is the
 * person's own setting for that peer. Every place that says so reads its words from here.
 */
import type { ServerFeatureRefusal } from 'citadel-workspace-client-ts';
export type StorageOffer =
  | { readonly kind: 'checking' }
  | { readonly kind: 'offered' }
  | { readonly kind: 'refused'; readonly reason: string };

export const SERVER_STORAGE_CHECKING: string = 'Checking whether this server stores files…';
export const SERVER_STORAGE_OFF: string = 'Server storage is not available.';
export const PEER_STORAGE_OFF: string = 'P2P remote storage is not enabled for this peer.';

export const CHECKING: StorageOffer = { kind: 'checking' };
export const OFFERED: StorageOffer = { kind: 'offered' };

export const offerOf = (takesFiles: boolean, refusal: string): StorageOffer => (takesFiles ? OFFERED : { kind: 'refused', reason: refusal });

/**
 * The server's own reason its storage takes no files, in words; the generic sentence only when
 * it gave none (a server older than the reason).
 */
export function serverStorageRefusal(refusal: ServerFeatureRefusal | null): string {
  if (refusal === null) return SERVER_STORAGE_OFF;
  if (refusal === 'DisabledByConfig') return 'Server storage is turned off on this server.';
  if (refusal === 'NoBackend') return 'The server has no storage backend.';
  return `This server's ${refusal.BackendCannotStoreStreamedObjects.backend} storage cannot hold files.`;
}
