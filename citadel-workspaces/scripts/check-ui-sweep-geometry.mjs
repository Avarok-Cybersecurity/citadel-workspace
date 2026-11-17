/**
 * Measured layout for the quality sweep: people, overlays, spacing, touch reach, in a real browser engine.
 * The focused sidebar's rows, ARIA and motion (a selection must glide, not jump) are measured here too,
 * and every permission editor's ticks sit in the middle of their boxes. The file manager is measured in
 * each state it draws: list, grid, inspector, bulk bar, transfers, empty, a deep path and its context menu The header's breadcrumbs fit their bar. The share dialog fits a 375px phone, its link and Copy both visible.
 * The Citadel Docs ribbon passes axe on every tab and collapsed group, keeps 44px targets, and never widens the page.
 * A moved chat document's loss banner, opened all the way, fits a phone, wraps its original's text and passes axe.
 * A member's P2P consent panel fits a 375px phone: every control inside it, 44px targets, long blocked names wrapped.
 * An app's toolbar fits a 375px phone: host buttons with plain-text labels, 44px targets, above the zone.
 * Every enabled button in every dialog a scenario opens sits inside its dialog and takes a click at its centre.
 * A node channel's shared-file cards (file, picture, downloading, refused), its upload strip (storing, shared,
 * refused) and the composer's destination line fit 375px and desktop, under Full and Lite motion, with 44px targets.
 * A node's tab row at its fullest fits a phone: 44px tabs that scroll, "+" and the tab menu always in reach.
 * Serves the real components (see lib/polish-harness) and asserts bounding boxes, in Chromium and WebKit,
 * light and dark, at desktop and phone widths.
 */
import { runChecks } from './lib/polish-harness/run-checks.mjs';
import { PEOPLE_CHECKS } from './lib/polish-harness/checks-people.mjs';
import { OVERLAY_CHECKS } from './lib/polish-harness/checks-overlays.mjs';
import { SPACING_CHECKS } from './lib/polish-harness/checks-spacing.mjs';
import { CONTROL_CHECKS } from './lib/polish-harness/checks-controls.mjs';
import { SIDEBAR_CHECKS } from './lib/polish-harness/checks-sidebar.mjs';
import { PERMISSION_CHECKS } from './lib/polish-harness/checks-permissions.mjs';
import { FILE_MANAGER_CHECKS } from './lib/polish-harness/checks-file-manager.mjs';
import { BREADCRUMB_CHECKS } from './lib/polish-harness/checks-breadcrumbs.mjs';
import { SHARE_CHECKS } from './lib/polish-harness/checks-share.mjs';
import { RIBBON_CHECKS } from './lib/polish-harness/checks-ribbons.mjs';
import { MIGRATION_CHECKS } from './lib/polish-harness/checks-migration.mjs';
import { APP_TOOLBAR_CHECKS } from './lib/polish-harness/checks-app-toolbar.mjs';
import { PEER_CONSENT_CHECKS } from './lib/polish-harness/checks-peer-consent.mjs';
import { DIALOG_FOOTER_CHECKS } from './lib/polish-harness/checks-dialog-footers.mjs';
import { SERVER_FILE_CHECKS } from './lib/polish-harness/checks-server-files.mjs';
import { NODE_TAB_CHECKS } from './lib/polish-harness/checks-node-tabs.mjs';

process.exit(await runChecks({ ...PEOPLE_CHECKS, ...OVERLAY_CHECKS, ...CONTROL_CHECKS, ...SPACING_CHECKS, ...SIDEBAR_CHECKS, ...PERMISSION_CHECKS, ...FILE_MANAGER_CHECKS, ...BREADCRUMB_CHECKS, ...SHARE_CHECKS, ...RIBBON_CHECKS, ...MIGRATION_CHECKS, ...APP_TOOLBAR_CHECKS, ...PEER_CONSENT_CHECKS, ...NODE_TAB_CHECKS, ...SERVER_FILE_CHECKS, ...DIALOG_FOOTER_CHECKS }, Number(process.env.SWEEP_PORT ?? 4198)));
