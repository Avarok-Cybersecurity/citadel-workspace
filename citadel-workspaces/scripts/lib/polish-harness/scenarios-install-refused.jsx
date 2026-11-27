/** A refused install's next steps at their widest: a long app name, a long link, a member's and a manager's steps, and a clipboard that cannot be reached. */
import { InstallRefused } from '@/components/citadel-apps/marketplace/InstallRefused';

const NOOP = () => {};
const REFUSED = {
  appName: 'synchronized.work — the live task tree of the whole engineering floor',
  appId: 'work.synchronized.app',
  version: '0.1.0',
  where: 'Everyone on “Quarterly planning for the platform and infrastructure teams” and the pages below it',
  link: 'https://work.example/workspace?app=work.synchronized.app&scope=node:0b5f9a1e-6c3d-4d8e-9a77-2f4c1b8e5d60&v=0.1.0',
  refusal: 'Unavailable',
  copy: 'This app is not available to you.',
};
const unreachable = () => Promise.reject(new Error('The clipboard is not allowed here'));

function Refused({ manages }) {
  return (
    <div style={{ padding: 16, maxWidth: 640 }}>
      <InstallRefused refused={REFUSED} manages={manages} actions={{ retry: NOOP, changeChoice: NOOP, showInstalled: NOOP, copyText: unreachable }} />
    </div>
  );
}

export const INSTALL_REFUSED_SCENARIOS = {
  'install-refused-member': () => <Refused manages={false} />,
  'install-refused-manager': () => <Refused manages />,
};
