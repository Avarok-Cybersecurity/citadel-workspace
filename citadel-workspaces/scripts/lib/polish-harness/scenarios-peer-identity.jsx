/**
 * A peer's identity in the chat: the mark in the real header (verified, unverified, key changed)
 * and the two dialogs it opens. Real components over a fixed agent answer, so no agent is needed.
 * The peer is named like CI's peers, one long unbreakable token, which is what overflows a phone.
 */
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { P2PChatHeader } from '@/components/p2p/P2PChatHeader';
import { PeerIdentityMark } from '@/components/p2p/peer-identity/PeerIdentityMark';

const PEER = 'file_alice_1794760367429';
const MINE = 'k7q2-m9xd-4hpt-z3wa';
const PINNED = 'b8re-2nvc-q6ly-t1ok';
const NEW_KEY = 'w5sj-x0fu-e7gm-r4ci';

function Header({ view }) {
  return (
    <MemoryRouter>
      <TooltipProvider>
        <P2PChatHeader
          peerName={PEER} peerUsername={PEER} peerPresence={null} peerTyping={false}
          isConnected={view.pending === null} isRegistered paused={false}
          connectionRoute={{ path: 'server_relay', upgrading: false }} supervisor={null}
          identity={<PeerIdentityMark peerName={PEER} view={view} onAccept={async () => {}} />}
          onSettingsClick={() => {}} onOpenFiles={() => {}} onShare={() => {}}
          call={{ canCall: true, inCall: false, capability: { supported: true }, onStartCall: () => {}, onLeave: () => {} }}
        />
      </TooltipProvider>
    </MemoryRouter>
  );
}

export const PEER_IDENTITY_SCENARIOS = {
  'peer-identity-verified': () => <Header view={{ own: MINE, pinned: PINNED, pending: null }} />,
  'peer-identity-unverified': () => <Header view={{ own: null, pinned: null, pending: null }} />,
  'peer-identity-changed': () => <Header view={{ own: MINE, pinned: PINNED, pending: NEW_KEY }} />,
};
