/**
 * Measured layout for the release-N+1 chat polish, in a real browser engine.
 *
 * jsdom has no layout, so "the card covers the row above" and "the message sits against the
 * bubble above it" cannot be asserted there; the classes can all be right and the pixels wrong.
 * This serves the real components (see lib/polish-harness) and asserts bounding boxes, in
 * Chromium and WebKit, at desktop and phone widths.
 */
import { runChecks } from './lib/polish-harness/run-checks.mjs';
import { CHECKS } from './lib/polish-harness/checks.mjs';

process.exit(await runChecks(CHECKS, Number(process.env.POLISH_PORT ?? 4197)));
