import { useState, useEffect, useCallback, useRef  , type MutableRefObject } from 'react';
import { describeFailure } from '@/lib/failure-message';
import { connectionManager } from '@/lib/connection';
import { eventEmitter } from '@/lib/event-emitter';
import { useToast } from '@/hooks/use-toast';
import { toastSuccess, toastError } from '@/lib/toast-helpers';
import { applyPeerRegisterFailure, correlateFailure, discoveryRefusalCopy, noteRecorded, type SentRequest } from './peer-register-failure';
import type { SentPeerRegistration } from '@/lib/p2p/send-peer-registration';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { peerRegistrationStore, OutgoingPeerRequest, PendingPeerRequest } from '@/lib/peer-registration-store';
import { getSelectedUser , type TabUserContext } from '@/lib/tab-context';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { sendPeerRegistration } from '@/lib/p2p/send-peer-registration';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { narrowWebSocketMessage, hasVariant, getVariant } from '@/lib/ws-message-boundary';
import { discoverPeersViaGetSessions, fetchRegisteredPeers, fetchAllPeers } from './peer-discovery-requests';
import { connectionRequestSentCopy } from './connection-request-copy';
import type { WebSocketMessage } from '@/types/ws-message-types';
import type { StoredSession } from '@/types/session-types';

export interface Peer {
  cid: string;
  username: string;
  fullName?: string;
  is_online: boolean | null; // null: not known, or hidden by the member (lib/presence.ts)
  is_registered?: boolean;
}

export function usePeerDiscovery(isOpen: boolean): { peers: Peer[] | null; registeredPeers: Set<string>; outgoingRequests: Set<string>; incomingRequests: Map<string, PendingPeerRequest>; loading: boolean; acceptingPeerCid: string | null; currentCid: bigint | null; currentUsername: string; discoverPeers: (announce?: boolean) => Promise<void>; acceptIncomingRequest: (request: PendingPeerRequest) => Promise<void>; registerWithPeer: (peerCid: string, peerUsername: string, announce: boolean) => Promise<boolean>; } {
  /** `null` until discovery succeeds — see PeerDiscoveryModal's empty states. */
  const [peers, setPeers] = useState<Peer[] | null>(null);
  // requestId -> peer name; see peer-register-failure.ts.
  const sentRequests: MutableRefObject<Map<string, SentRequest>> = useRef(new Map<string, SentRequest>());
  const [registeredPeers, setRegisteredPeers] = useState<Set<string>>(new Set());
  const [outgoingRequests, setOutgoingRequests] = useState<Set<string>>(new Set());
  const [incomingRequests, setIncomingRequests] = useState<Map<string, PendingPeerRequest>>(new Map());
  const [loading, setLoading] = useState(false);
  const [acceptingPeerCid, setAcceptingPeerCid] = useState<string | null>(null);
  const [currentCid, setCurrentCid] = useState<bigint | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>('Unknown');
  const { toast } = useToast();
  const { state } = useWorkspace();

  useEffect(() => {
    const loadConnectionInfo = async (): Promise<void> => {
      const tabSelection: TabUserContext | null = await getSelectedUser();
      const tabSession: StoredSession | null = await connectionManager.getTabSelectedSession();
      const cid: bigint | null = tabSelection?.selectedCid || tabSession?.cid || connectionManager.getConnectionInfo()?.cid || null;
      const username: string = tabSelection?.selectedUsername || tabSession?.username || state.currentUser?.username || 'Unknown';
      setCurrentCid(cid);
      setCurrentUsername(username);
    };
    runAsyncSetup(loadConnectionInfo);
  }, [state.currentUser?.username]);

  // Listen for outgoing request updates
  useEffect(() => {
    const handleOutgoingUpdate = (data: { requests: OutgoingPeerRequest[]; cids: Set<bigint> }): void => {
      const stringCids: Set<string> = new Set<string>();
      data.cids.forEach(cid => stringCids.add(cid.toString()));
      setOutgoingRequests(stringCids);
    };
    eventEmitter.on('outgoing-peer-requests:updated', handleOutgoingUpdate);
    return (): void => { eventEmitter.off('outgoing-peer-requests:updated', handleOutgoingUpdate); };
  }, []);

  // Listen for incoming pending requests
  useEffect(() => {
    const updateIncomingRequests = async (): Promise<void> => {
      const pending: PendingPeerRequest[] = await peerRegistrationStore.getPendingRequests();
      const incomingMap: Map<string, PendingPeerRequest> = new Map<string, PendingPeerRequest>();
      pending.forEach(req => { incomingMap.set(req.peer_cid.toString(), req); });
      setIncomingRequests(incomingMap);
    };
    if (isOpen) { runAsyncSetup(updateIncomingRequests); }
    eventEmitter.on('peer-requests:updated', updateIncomingRequests);
    return (): void => { eventEmitter.off('peer-requests:updated', updateIncomingRequests); };
  }, [isOpen]);

  // Listen for PeerRegisterSuccess/PeerConnectSuccess
  useEffect(() => {
    const handleRegistrationSuccess = (raw: unknown): void => {
      const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
      if (!message) return;
      if (hasVariant(message, 'PeerRegisterFailure')) {
        const failure: Record<string, unknown> = getVariant(message, 'PeerRegisterFailure')!;
        const correlated: ReturnType<typeof correlateFailure> = correlateFailure(failure, sentRequests.current);
        if (correlated) {
          sentRequests.current.delete(correlated.requestId);
          applyPeerRegisterFailure(failure, {
            // The peer WE sent to, not whatever the response names.
            markRegistered: (): void =>
              setRegisteredPeers(prev => new Set([...prev, correlated.peer.cid.toString()])),
            reportRefusal: (reason: string | undefined): void => {
              const copy: string | null = discoveryRefusalCopy(correlated.peer, reason);
              if (copy) toastError(toast, 'Request Failed', copy);
            },
          });
        }
      }
      if (hasVariant(message, 'PeerRegisterSuccess')) {
        const peerCid: string | undefined = (getVariant(message, 'PeerRegisterSuccess')!.peer_cid as bigint | undefined)?.toString();
        if (peerCid) { setRegisteredPeers(prev => new Set([...prev, peerCid])); }
      }
      if (hasVariant(message, 'PeerConnectSuccess')) {
        const peerCid: string | undefined = (getVariant(message, 'PeerConnectSuccess')!.peer_cid as bigint | undefined)?.toString();
        if (peerCid) { setRegisteredPeers(prev => new Set([...prev, peerCid])); }
      }
    };
    eventEmitter.on('websocket-message', handleRegistrationSuccess);
    return (): void => { eventEmitter.off('websocket-message', handleRegistrationSuccess); };
    // `toast` is a stable module function (see hooks/use-toast), so this
    // re-subscribes on nothing.
  }, [toast]);

  // Listen for incoming registration notifications
  useEffect(() => {
    const handleIncomingRegistration = async (raw: unknown): Promise<void> => {
      const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
      if (!message) return;
      if (hasVariant(message, 'PeerRegisterNotification')) {
        await peerRegistrationStore.handleIncomingRequest(getVariant(message, 'PeerRegisterNotification') as { cid: bigint; peer_cid: bigint; peer_username?: string });
      }
    };
    eventEmitter.on('websocket-message', handleIncomingRegistration);
    return (): void => { eventEmitter.off('websocket-message', handleIncomingRegistration); };
  }, []);

  const loadRegisteredPeers: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!currentCid) return;
    try {
      const registered: Set<string> = await fetchRegisteredPeers(currentCid);
      setRegisteredPeers(registered);
    } catch (error) {
      debugLog('PeerDiscoveryModal', 'Failed to load registered peers:', error);
    }
  }, [currentCid]);

  /**
   * `announce` separates a user asking from the mount-time effect below.
   *
   * The CID loads asynchronously and the trigger effect runs on the same mount
   * with the modal already open, so every visit to the User Directory toasted
   * "Not Connected" in red on a page that was about to work: a tick later the
   * CID landed and the effect re-ran and succeeded silently.
   */
  const discoverPeers: (announce?: boolean) => Promise<void> = useCallback(async (announce = true): Promise<void> => {
    if (!currentCid) {
      if (announce) {
        toastError(toast, "Not Connected", "Please connect to a workspace first");
      }
      return;
    }
    setLoading(true);
    try {
      const processedPeers: Peer[] = await fetchAllPeers(currentCid);
      setPeers(processedPeers);
      loadRegisteredPeers().catch(err => { debugLog('PeerDiscoveryModal', 'Could not load registered peers:', err); });

      if (processedPeers.length === 0) {
        debugLog('PeerDiscoveryModal', 'ListAllPeers returned empty, trying GetSessions fallback...');
        const sessionPeers: Peer[] = await discoverPeersViaGetSessions(currentCid);
        if (sessionPeers.length > 0) {
          setPeers(sessionPeers);
          loadRegisteredPeers().catch(err => { debugLog('PeerDiscoveryModal', 'Could not load registered peers:', err); });
          toastSuccess(toast, "Peers Discovered", `Found ${sessionPeers.length} other user${sessionPeers.length > 1 ? 's' : ''} via session lookup`);
          return;
        }
        toastSuccess(toast, "No Peers Found", "You are the only user connected to this workspace");
      } else {
        toastSuccess(toast, "Peers Discovered", `Found ${processedPeers.length} other user${processedPeers.length > 1 ? 's' : ''} in the workspace`);
      }
    } catch (error) {
      debugLog('PeerDiscoveryModal', 'Failed to discover peers via ListAllPeers:', error);
      try {
        const sessionPeers: Peer[] = await discoverPeersViaGetSessions(currentCid);
        if (sessionPeers.length > 0) {
          setPeers(sessionPeers);
          loadRegisteredPeers().catch(err => { debugLog('PeerDiscoveryModal', 'Could not load registered peers:', err); });
          toastSuccess(toast, "Peers Discovered", `Found ${sessionPeers.length} other user${sessionPeers.length > 1 ? 's' : ''} via session lookup`);
          return;
        }
      } catch (fallbackError) {
        debugLog('PeerDiscoveryModal', 'GetSessions fallback also failed:', fallbackError);
      }
      toastError(toast, "Discovery Failed", describeFailure(error, "Could not discover peers in the workspace"));
    } finally {
      setLoading(false);
    }
  }, [currentCid, toast, loadRegisteredPeers]);

  useEffect(() => {
    if (isOpen) {
      runAsyncSetup(() => discoverPeers(false));
      const loadOutgoing = async (): Promise<void> => {
        const bigintCids: Set<bigint> = await peerRegistrationStore.getOutgoingRequestCids();
        const stringCids: Set<string> = new Set<string>();
        bigintCids.forEach(cid => stringCids.add(cid.toString()));
        setOutgoingRequests(stringCids);
      };
      runAsyncSetup(loadOutgoing);
    }
  }, [isOpen, discoverPeers]);

  const acceptIncomingRequest = async (request: PendingPeerRequest): Promise<void> => {
    setAcceptingPeerCid(request.peer_cid.toString());
    try {
      await peerRegistrationStore.acceptRequest(request.id);
      await loadRegisteredPeers();
    } catch (error) {
      toastError(toast, 'Failed to Accept', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setAcceptingPeerCid(null);
    }
  };

  /** True once the request is on the wire; false when not sent (toasted). `announce`: toast the send. */
  const registerWithPeer = async (peerCid: string, peerUsername: string, announce: boolean): Promise<boolean> => {
    if (!currentCid) {
      toastError(toast, "Not Connected", "Please connect to a workspace first");
      return false;
    }
    try {
      const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
      broadcastChannelService.registerRequest(requestId, currentCid);
      // Before the send: a failure can arrive before the await resolves.
      sentRequests.current.set(requestId, { cid: BigInt(peerCid), username: peerUsername });
      const sent: SentPeerRegistration = await sendPeerRegistration(currentCid, BigInt(peerCid), peerUsername, requestId);
      noteRecorded(sentRequests.current, requestId, sent.recorded);
      if (announce) toast({
        title: "Request Sent",
        description: connectionRequestSentCopy(peerUsername, peers?.find((p: Peer): boolean => p.cid === peerCid)?.is_online ?? null),
        variant: 'success',
      });
      return true;
    } catch (error) {
      debugLog('PeerDiscoveryModal', 'Failed to send registration request:', error);
      toastError(toast, "Request Failed", describeFailure(error, "Could not send registration request"));
      return false;
    }
  };

  return {
    peers, registeredPeers, outgoingRequests, incomingRequests,
    loading, acceptingPeerCid, currentCid, currentUsername,
    discoverPeers, acceptIncomingRequest, registerWithPeer,
  };
}
