/**
 * The strip under the header of a chat with someone you are not registered with yet.
 *
 * The chat opens regardless (owner, 2026-10-15); this says why nothing can be sent yet and does
 * the one thing that fixes it. Under the workspace's messaging trust the request goes out on
 * open, so most people only ever see "Connecting…" for a moment. A status, not an alert.
 */
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePeerDiscovery } from './usePeerDiscovery';
import { useConnectRequest, type ConnectRequest, type ConnectRequestDeps } from './hooks/use-connect-request';
import { messagingTrustApi } from '@/lib/messaging-trust/messaging-trust-api';
import { askPeerTrust, UNTRUSTED } from '@/lib/messaging-trust/peer-trust';
import { peerRegistrationStore } from '@/lib/peer-registration-store';
import { workspacePeerWithCid } from '@/lib/workspace-peers';
import { unreachableMemberCopy } from '@/pages/reachable-peer';
import type { PeerTrust } from '@/lib/workspace-service/messaging-trust-operations';

interface ConnectRequestBannerProps {
  peerCid: bigint;
  peerName: string;
  /** Absent when the caller knows only a display name; the agent's listing is asked instead. */
  peerUsername: string | undefined;
  registered: boolean;
}

export function ConnectRequestBanner({ peerCid, peerName, peerUsername, registered }: ConnectRequestBannerProps): JSX.Element | null {
  const { currentCid, registerWithPeer } = usePeerDiscovery(false);
  const username: string | undefined = peerUsername ?? workspacePeerWithCid(peerCid)?.username;
  const deps: ConnectRequestDeps = {
    askTrust: (): Promise<PeerTrust> =>
      currentCid === null ? Promise.resolve(UNTRUSTED) : askPeerTrust(messagingTrustApi, currentCid, username),
    send: (announce: boolean): Promise<boolean> =>
      (username ? registerWithPeer(peerCid.toString(), username, announce) : Promise.resolve(false)),
    alreadyAsked: (): boolean => currentCid !== null && peerRegistrationStore.hasOutgoingRequestTo(peerCid, currentCid),
  };
  const { stage, request }: ConnectRequest = useConnectRequest(registered, currentCid !== null, deps);
  if (registered) return null;

  const busy: boolean = stage === 'sending' || stage === 'connecting';
  return (
    <div
      role="status"
      data-testid="p2p-connect-banner"
      data-stage={stage}
      className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/40 bg-primary/10 px-4 py-2"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        {busy
          ? <Loader2 className="h-4 w-4 shrink-0 text-primary-accent motion-safe:animate-spin" aria-hidden="true" />
          : <UserPlus className="h-4 w-4 shrink-0 text-primary-accent" aria-hidden="true" />}
        <span className="min-w-0">
          {busy && `Connecting with ${peerName}…`}
          {stage === 'waiting' && `Waiting for ${peerName} to accept your connect request.`}
          {stage === 'offer' && (username
            ? `You aren't connected with ${peerName} yet. Send a connect request to start messaging.`
            : unreachableMemberCopy(peerName))}
        </span>
      </p>
      {stage === 'offer' && username && (
        <Button size="sm" variant="outline" className="shrink-0" onClick={request} data-testid="p2p-connect-request">
          Send connect request
        </Button>
      )}
    </div>
  );
}
