/**
 * The top bar's switcher row for an account the agent no longer holds, the sign-in it opens,
 * and that sign-in scoped to its server (the scope, no saved account there, another server's
 * username, server-named rows), measured at 375px as well as the harness's 390px and desktop,
 * under Full and Lite motion as well as reduced: the menu and the sign-in animate in.
 */
import { runMatrix } from './lib/polish-harness/run-checks.mjs';
import { ACCOUNT_SWITCH_CHECKS } from './lib/polish-harness/checks-account-switch.mjs';

const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 375, height: 667 }];
const MOTIONS = [
  { name: 'reduced', reducedMotion: 'reduce', tier: 'full' },
  { name: 'full', reducedMotion: 'no-preference', tier: 'full' },
  { name: 'lite', reducedMotion: 'no-preference', tier: 'lite' },
];

process.exit(await runMatrix(ACCOUNT_SWITCH_CHECKS, Number(process.env.ACCOUNT_SWITCH_PORT ?? 4206), { viewports: VIEWPORTS, motions: MOTIONS }));
