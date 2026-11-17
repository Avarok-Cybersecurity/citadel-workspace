/**
 * The Calendar's grids, views and panels in a real browser engine (design §3.10): every day reachable
 * by keyboard through one roving tab stop; each view, the tab mounted whole, each panel it opens
 * (event editor, booking pages and setup, event details, team types, polls, routing forms) laid out
 * at 375px and on a desktop with 44px targets, no sideways scroll, and axe clean at rest.
 *
 * And what the controls do: cancelling one of the node's own events takes it off the page below; the
 * host's Cancel cancels their booking; a round robin goes to the host with fewer bookings that month;
 * a vote and a pick are saved; a routing answer opens the page it routes to. jsdom has no layout and
 * no real focus order, so none of this is visible to the unit tests. Serves the real components and
 * the shipped engine through lib/polish-harness.
 */
import { runChecks } from './lib/polish-harness/run-checks.mjs';
import { CALENDAR_CHECKS } from './lib/polish-harness/checks-calendar.mjs';
import { CALENDAR_PANEL_CHECKS } from './lib/polish-harness/checks-calendar-panels.mjs';
import { CALENDAR_CHANGE_CHECKS } from './lib/polish-harness/checks-calendar-changes.mjs';
import { CALENDAR_TEAM_CHECKS } from './lib/polish-harness/checks-calendar-teams.mjs';

process.exit(await runChecks({ ...CALENDAR_CHECKS, ...CALENDAR_PANEL_CHECKS, ...CALENDAR_CHANGE_CHECKS, ...CALENDAR_TEAM_CHECKS }, Number(process.env.CALENDAR_HARNESS_PORT ?? 4203)));
