/**
 * A peer's identity in the chat (the header mark, the safety number, the changed-key screen)
 * at 390px and 375px as well as desktop, light and dark: fits the viewport, touch-sized answers,
 * and no serious or critical axe finding.
 */
import { runMatrix } from './lib/polish-harness/run-checks.mjs';
import { PEER_IDENTITY_CHECKS } from './lib/polish-harness/checks-peer-identity.mjs';

const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 375, height: 667 }];
const MOTIONS = [{ name: 'reduced', reducedMotion: 'reduce', tier: 'full' }];

process.exit(await runMatrix(PEER_IDENTITY_CHECKS, { viewports: VIEWPORTS, motions: MOTIONS }));
