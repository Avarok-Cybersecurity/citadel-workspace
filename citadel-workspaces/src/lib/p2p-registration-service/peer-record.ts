/**
 * The `Peer` record this service hands to the rest of the app.
 *
 * The same five-field literal was written out in five places across three
 * files, each pairing `username` and `fullName` with its own idea of a name.
 * They are built here instead, from `peerDisplayName`, so a peer whose name is
 * not yet known gets the one handle every surface agrees on -- and one the
 * placeholder check recognises, so the real name replaces it when it arrives.
 */
import { peerDisplayName } from '@/lib/peer-display';
import type { Peer } from './types';

export function peerRecord(cid: bigint, username: string | undefined, isOnline: boolean): Peer {
  const name: string = peerDisplayName({ cid, username });
  return { cid, username: name, fullName: name, isOnline, isRegistered: true };
}
