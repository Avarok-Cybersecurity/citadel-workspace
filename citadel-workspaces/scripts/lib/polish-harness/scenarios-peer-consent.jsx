/** A member's own P2P and topic answers for one install, at its widest: a long app name, every plane, one unanswered, and long blocked usernames. */
import { PeerConsentPanel } from '@/components/citadel-apps/marketplace/PeerConsentPanel';
import { memberAsks } from '@/lib/citadel-apps/consent-model';

const NOOP = () => {};
const GRANTED = ['ihttp.serve', 'ihttp.call', 'ihttp.p2p.serve', 'ihttp.p2p.call', 'group.topic.subscribe', 'group.topic.publish'];

function Panel({ consent, blocked }) {
  return (
    <div style={{ padding: 16 }}>
      <PeerConsentPanel appName="Compute Pool — distributed prime counting for the whole engineering floor" asks={memberAsks(GRANTED, consent)}
        blocked={blocked} busy={false} onSet={NOOP} onBlock={NOOP} />
    </div>
  );
}

export const PEER_CONSENT_SCENARIOS = {
  'peer-consent-unanswered': () => <Panel consent={null} blocked={[]} />,
  'peer-consent-answered': () => <Panel consent={{ serve: true, call: false, topics: true, at_ms: 1n }} blocked={['bartholomew.extraordinarily-long-username-without-breaks', 'carol']} />,
};
