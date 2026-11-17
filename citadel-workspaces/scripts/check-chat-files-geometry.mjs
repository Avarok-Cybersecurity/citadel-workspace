/**
 * The chat's file surfaces (the picture in its bubble, the full-size viewer, the first-offer
 * "always accept?" question) measured at 375px as well as the harness's 390px and desktop, and
 * under Full and Lite motion as well as reduced: their dialogs animate in, and a box measured
 * mid-animation is not where it lands.
 */
import { runMatrix } from './lib/polish-harness/run-checks.mjs';
import { CHAT_FILE_CHECKS } from './lib/polish-harness/checks-chat-files.mjs';

const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 375, height: 667 }];
const MOTIONS = [
  { name: 'reduced', reducedMotion: 'reduce', tier: 'full' },
  { name: 'full', reducedMotion: 'no-preference', tier: 'full' },
  { name: 'lite', reducedMotion: 'no-preference', tier: 'lite' },
];

process.exit(await runMatrix(CHAT_FILE_CHECKS, Number(process.env.CHAT_FILES_PORT ?? 4199), { viewports: VIEWPORTS, motions: MOTIONS }));
