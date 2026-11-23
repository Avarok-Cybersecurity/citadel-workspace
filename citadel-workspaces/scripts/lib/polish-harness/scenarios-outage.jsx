/** The notice a service failure puts in place of the workspace: alone, and over a workspace that stays mounted. */
import { ServiceUnavailable } from '@/components/outage/ServiceUnavailable';

const retried = () => document.body.setAttribute('data-retried', 'yes');

/** What stays mounted under the notice: tall and wide enough to show through anything that is not opaque. */
function WorkspaceBehind() {
  return (
    <div data-testid="behind" style={{ minHeight: '100vh', padding: 16 }}>
      <button type="button" data-testid="behind-button" style={{ width: '100%', height: 200 }}>A control of the workspace behind the notice</button>
    </div>
  );
}

export const OUTAGE_SCENARIOS = {
  'outage-notice': () => <ServiceUnavailable kind="server-unreachable" onRetry={retried} />,
  'outage-over-workspace': () => (<><WorkspaceBehind /><ServiceUnavailable kind="reconnect-slow" onRetry={retried} /></>),
};
