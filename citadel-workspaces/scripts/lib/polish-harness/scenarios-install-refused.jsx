/** A refused install's ways out at their widest: a long app name, a long link and place, a member's and a manager's view. */
import { useEffect } from 'react';
import { AppsRefusalNotice } from '@/components/citadel-apps/marketplace/AppsRefusalNotice';
import { adminAskAbout, managersLine } from '@/lib/citadel-apps/refused-install';
import { recoveryPortsStore } from '@/lib/recovery-route/ports-store';

const NOOP = () => {};
const REFUSED = {
  appName: 'synchronized.work — the live task tree of the whole engineering floor',
  version: '0.1.0',
  where: 'Everyone on “Quarterly planning for the platform and infrastructure teams” and the pages below it',
  link: 'https://work.example/workspace?app=work.synchronized.app&scope=node:0b5f9a1e-6c3d-4d8e-9a77-2f4c1b8e5d60&v=0.1.0',
  copy: 'This app is not available to you.',
};
// The ports a signed-in window registers; here asking answers as the server refuses a sole admin, its longest sentence.
const PORTS = {
  reload: NOOP, applyUpdate: NOOP, openSettings: NOOP, navigate: NOOP, signIn: NOOP, installAgent: NOOP, requestPermission: NOOP, openChat: NOOP, reportBug: NOOP,
  askAdmins: async () => /** @type {import('@/lib/recovery-route/ports').AskOutcome} */ ({ kind: 'refused', sentence: 'You are the only admin here, so there is nobody to ask. You can change this yourself in Settings.' }),
};

function Refused({ manages }) {
  useEffect(() => { recoveryPortsStore.set(PORTS); return () => recoveryPortsStore.set(null); }, []);
  return (
    <div style={{ padding: 16, maxWidth: 640 }}>
      <AppsRefusalNotice testId="apps-install-failed" surface="apps.Unavailable" message={`${REFUSED.appName} was not installed. ${REFUSED.copy}`}
        forManagers={managersLine('Unavailable', manages)} binding={{ retry: async () => {}, focus: NOOP, dismiss: NOOP, askAbout: adminAskAbout(REFUSED) }} />
    </div>
  );
}

export const INSTALL_REFUSED_SCENARIOS = {
  'install-refused-member': () => <Refused manages={false} />,
  'install-refused-manager': () => <Refused manages />,
};
