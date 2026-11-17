/**
 * useRegisteredPeers Hook
 *
 * Manages registered P2P peer state including loading, merging cache/backend data,
 * status tracking, and stale conversation cleanup.
 */

import { isPlaceholderName, peerDisplayName, peerHandleName } from '@/lib/peer-display';
import { useState, useEffect, useRef, useCallback , type MutableRefObject } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import { p2pAutoConnectService } from '@/lib/p2p-auto-connect-service';
import { connectionPathFor } from '@/lib/p2p-auto-connect-service/connection-path';
import { PATH_CHANGED_EVENT } from '@/lib/p2p-auto-connect-service/path-changes';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import type { PeerConnectPath } from '@/types/ice-servers';
import { sessionStartupService } from '@/lib/session-startup-service';
import { P2PMessengerManager } from '@/lib/p2p';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { recordPeerUsernames } from '@/lib/member-names';
import { shownPresence } from '@/lib/presence';

export interface RegisteredPeer {
  cid: string;
  /** What the peer is addressed by (test ids, routes, lookups). See peerHandleName. */
  username: string;
  /** What the peer is shown as: the roster's name when it has one. */
  displayName: string;
  /** True, false, or null when no poll has landed. See lib/presence.ts. */
  isOnline: boolean | null;
  /**
   * True, false, or null when the check did not answer in time.
   *
   * A one-second race that resolves `false` is a stopwatch, not an answer: a
   * connected peer whose check was slow rendered as merely online. Same shape
   * as `isOnline` above.
   */
  isConnected: boolean | null;
  /** How the connection travels, when the agent has said. */
  connectionPath: PeerConnectPath | null;
}

interface UseRegisteredPeersReturn {
  registeredPeers: RegisteredPeer[];
  isLoading: boolean;
  refreshPeers: () => Promise<void>;
}

export function useRegisteredPeers(): UseRegisteredPeersReturn {
  const [registeredPeers, setRegisteredPeers] = useState<RegisteredPeer[]>([]);
  // True from the start: the mount effect loads at once, and "not loading, empty" reads as "no peers".
  const [isLoading, setIsLoading] = useState(true);
  const [startupComplete, setStartupComplete] = useState(true);
  const startupCompleteRef: MutableRefObject<boolean> = useRef(startupComplete);

  useEffect(() => {
    startupCompleteRef.current = startupComplete;
  }, [startupComplete]);

  const loadRegisteredPeers: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const { registeredPeers: cachedPeers } = p2pRegistrationService.getPeers();

      let freshPeers: Array<{ cid?: bigint; username?: string }> = [];
      try {
        // Retrying variant, not the single-shot one. ListRegisteredPeers times out
        // intermittently under concurrent P2P activity; with a single attempt this
        // hook silently fell back to the cache, which is why a freshly-registered
        // peer could take a poll cycle (or several) to appear in the sidebar.
        freshPeers = await p2pRegistrationService.listRegisteredPeersWithRetry();
      } catch (e: unknown) {
        const errorMessage: string = e instanceof Error ? e.message : String(e);
        debugLog('UseRegisteredPeers', `listRegisteredPeers failed after retries (${errorMessage}), using cached peers`);
      }

      // Merge cached and fresh peers
      const mergedPeersMap: Map<string, { cid?: bigint; username?: string; }> = new Map<string, { cid?: bigint; username?: string }>();

      for (const p of cachedPeers) {
        const cidStr: string = p.cid?.toString() || '';
        if (cidStr) mergedPeersMap.set(cidStr, p);
      }

      for (const p of freshPeers) {
        const cidStr: string = p.cid?.toString() || '';
        if (cidStr) {
          const existing: { cid?: bigint; username?: string; } | undefined = mergedPeersMap.get(cidStr);
          if (existing) {
            const mergedPeer: { username: string | undefined; cid?: bigint; } = {
              ...p,
              username: isPlaceholderName(existing.username) ? p.username : existing.username
            };
            mergedPeersMap.set(cidStr, mergedPeer);
          } else {
            mergedPeersMap.set(cidStr, p);
          }
        }
      }

      const peersToUse: { cid?: bigint; username?: string; }[] = Array.from(mergedPeersMap.values());
      // So a call, a group or a transfer that names this peer by CID alone names them as this list does.
      recordPeerUsernames(peersToUse.flatMap((p): { cid: bigint; username: string }[] =>
        p.cid !== undefined && p.username && !isPlaceholderName(p.username) ? [{ cid: p.cid, username: p.username }] : []));
      eventEmitter.emit('p2p:peer-names-learned', {});

      let peerList: RegisteredPeer[] = [];
      try {
        const sessionCid: bigint | null = await getCurrentCid();
        peerList = await Promise.all(peersToUse.map(async p => {
          const cidStr: string = p.cid?.toString() || '';
          const displayName: string = peerDisplayName({ cid: p.cid, username: p.username });
          const username: string = peerHandleName({ cid: p.cid, username: p.username });
          const peerCidBigInt: bigint = p.cid ?? BigInt(0);
          const isOnline: boolean | null = shownPresence(p.username, peerCidBigInt, p2pAutoConnectService.peerOnlineStatus(peerCidBigInt));
          let isConnected: boolean | null = null;
          try {
            // Already `boolean | null`: the service answers null when this tab
            // cannot name its own session, which is not "not connected".
            const connectedPromise: Promise<boolean | null> = p2pAutoConnectService.isPeerConnected(peerCidBigInt);
            // Null, not false: the timeout means the check did not finish, which
            // is not the same as it having answered "no".
            const timeoutPromise: Promise<null> = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000));
            isConnected = await Promise.race<boolean | null>([connectedPromise, timeoutPromise]);
          } catch {
            isConnected = null;
          }
          const connectionPath: PeerConnectPath | null = connectionPathFor(sessionCid, peerCidBigInt);
          return { cid: cidStr, username, displayName, isOnline, isConnected, connectionPath };
        }));
      } catch (mapError) {
        debugLog('UseRegisteredPeers', 'Promise.all mapping failed:', mapError);
        peerList = peersToUse.map(p => {
          const cidStr: string = p.cid?.toString() || '';
          const displayName: string = peerDisplayName({ cid: p.cid, username: p.username });
          const username: string = peerHandleName({ cid: p.cid, username: p.username });
          // The listing failed; nobody has said whether these peers are online.
          return { cid: cidStr, username, displayName, isOnline: null, isConnected: null, connectionPath: null };
        });
      }

      setRegisteredPeers(peerList);

      // Clean up stale conversations
      const isStartupInProgress: boolean = sessionStartupService.isStartupInProgress();
      if (startupCompleteRef.current && !isStartupInProgress) {
        const validPeerCids: Set<bigint> = new Set(peerList.filter(p => p.cid).map(p => BigInt(p.cid)));
        const connectedPeerCids: bigint[] = await p2pAutoConnectService.getConnectedPeers();
        for (const cid of connectedPeerCids) {
          validPeerCids.add(cid);
        }

        const messenger: P2PMessengerManager = P2PMessengerManager.getInstance();
        const cleanedCount: number = await messenger.cleanupStaleConversations(validPeerCids);
        if (cleanedCount > 0) {
          debugLog('UseRegisteredPeers', `[P2P] useRegisteredPeers: Cleaned up ${cleanedCount} stale conversation(s)`);
        }
      }
    } catch (error) {
      debugLog('UseRegisteredPeers', 'Failed to load peers:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Track session startup state
  useEffect(() => {
    const handleSessionActivated = (event: { activationType: string }): void => {
      if (event.activationType === 'login' || event.activationType === 'claim') {
        setStartupComplete(false);
      }
    };
    const handleStartupComplete = (): void => setStartupComplete(true);

    eventEmitter.on('session:activated', handleSessionActivated);
    eventEmitter.on('session:startup-complete', handleStartupComplete);

    return (): void => {
      eventEmitter.off('session:activated', handleSessionActivated);
      eventEmitter.off('session:startup-complete', handleStartupComplete);
    };
  }, []);

  // Initial load and event listeners
  useEffect(() => {
    runAsyncSetup(loadRegisteredPeers);

    const handlePeerUpdate = async (): Promise<void> => { await loadRegisteredPeers(); };

    eventEmitter.on('p2p:peer-registered', handlePeerUpdate);
    eventEmitter.on('p2p:registration-accepted', handlePeerUpdate);
    eventEmitter.on('p2p:peers-updated', handlePeerUpdate);
    eventEmitter.on('p2p-connection-established', handlePeerUpdate);
    eventEmitter.on('p2p-connection-lost', handlePeerUpdate);
    // A connection delivered over the relay goes direct later; the row names its path.
    eventEmitter.on(PATH_CHANGED_EVENT, handlePeerUpdate);
    eventEmitter.on('session:startup-complete', handlePeerUpdate);

    return (): void => {
      eventEmitter.off('p2p:peer-registered', handlePeerUpdate);
      eventEmitter.off('p2p:registration-accepted', handlePeerUpdate);
      eventEmitter.off('p2p:peers-updated', handlePeerUpdate);
      eventEmitter.off('p2p-connection-established', handlePeerUpdate);
      eventEmitter.off('p2p-connection-lost', handlePeerUpdate);
      eventEmitter.off(PATH_CHANGED_EVENT, handlePeerUpdate);
      eventEmitter.off('session:startup-complete', handlePeerUpdate);
    };
  }, [loadRegisteredPeers]);

  return {
    registeredPeers,
    isLoading,
    refreshPeers: loadRegisteredPeers,
  };
}
