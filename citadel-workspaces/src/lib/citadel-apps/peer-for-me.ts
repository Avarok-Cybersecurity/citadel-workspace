/**
 * This member's P2P and topic answers and block lists, per install: the tab's copy of the
 * server's (`ListInstalls` says them all in `peer_for_me`; `PeerConsentForMe` and
 * `PeerBlockedForMe` say one change). The Installed list, the app zones and the host's ports read
 * the same copy; a reload reads it from the server again. Nothing here is the record.
 */
import { useSyncExternalStore } from 'react';
import { notifyEach } from '@/lib/notify-listeners';
import { blockedAfter } from './consent-model';
import type { PeerConsent, PeerForMe } from 'citadel-workspace-client-ts';

let byInstall: ReadonlyMap<string, PeerForMe> = new Map<string, PeerForMe>();
const listeners: Set<() => void> = new Set<() => void>();

function publish(next: ReadonlyMap<string, PeerForMe>): void {
  byInstall = next;
  notifyEach(listeners, 'apps-peer-for-me');
}

/** The server's whole list for this person: it replaces the tab's copy. Absent: never answered. */
export function adoptPeerForMe(entries: readonly PeerForMe[]): void {
  publish(new Map(entries.map((e: PeerForMe): [string, PeerForMe] => [e.install_id, e])));
}

export function recordPeerConsent(installId: string, consent: PeerConsent): void {
  const next: Map<string, PeerForMe> = new Map(byInstall);
  next.set(installId, { install_id: installId, consent, blocked: byInstall.get(installId)?.blocked ?? [] });
  publish(next);
}

/** A block without a consent answer keeps "never answered" for the planes: all off, at time 0. */
export function recordPeerBlocked(installId: string, username: string, blocked: boolean): void {
  const prior: PeerForMe | undefined = byInstall.get(installId);
  const consent: PeerConsent = prior?.consent ?? { serve: false, call: false, topics: false, at_ms: 0n };
  const next: Map<string, PeerForMe> = new Map(byInstall);
  next.set(installId, { install_id: installId, consent, blocked: blockedAfter(prior?.blocked ?? [], username, blocked) });
  publish(next);
}

export const peerForMe = (installId: string): PeerForMe | null => byInstall.get(installId) ?? null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

export function usePeerForMe(): ReadonlyMap<string, PeerForMe> {
  return useSyncExternalStore(subscribe, (): ReadonlyMap<string, PeerForMe> => byInstall, (): ReadonlyMap<string, PeerForMe> => byInstall);
}
