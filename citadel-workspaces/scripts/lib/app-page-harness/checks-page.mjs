/**
 * check-app-page.mjs, first half: the page mounts as a node's page (1), the link screen on a first
 * run (2), the code typed makes the app send exactly the recorded redeem (3), and the recorded
 * catch-up draws the project's tree inside the pane with no egress of its own (4).
 */
import { box, fmt, framesStopped, idle, missingFrom, record, regions, settledRegions, until, within } from './probe.mjs';

/** Test ids of what a document page wears and an app's page must not: the Edit button, the editor's save, the document host and its editor, the zone frame. */
const DOCUMENT_CHROME = ['office-edit-content', 'office-save-content', 'document-host', 'document-editor-region', 'app-zone-host'];
/** synchronized.work's own words for the link screen (sw-app-core copy.rs: LINK_FIELD_LABEL, ACTION_SUBMIT_CODE). */
const LINK_FIELD = 'Link code';
const SUBMIT = 'Link';
/** A person's pace at the keyboard; a burst of eight keys in one frame is not what this asserts. */
const KEY_DELAY_MS = 100;

export async function mountsAsAPage(page, label, check, t) {
  const running = await until(page, () => document.querySelector('[data-testid="app-page-pane"]')?.getAttribute('data-page-state') === 'running', undefined, 30_000);
  const seen = await page.evaluate(() => ({ pane: document.querySelectorAll('[data-testid="app-page-pane"]').length, state: document.querySelector('[data-testid="app-page-pane"]')?.getAttribute('data-page-state') ?? null, tab: document.querySelectorAll('[data-testid="app-tab-host"]').length }));
  if (!check(running && seen.pane === 1, `${label}: 1. the app runs as the node's page: one app-page-pane, data-page-state running (panes ${seen.pane}, state ${seen.state}, tab hosts ${seen.tab})`)) return false;
  const told = (await record(page)).worker.contexts[0] ?? null;
  const c = t.context;
  check(told !== null && told.surface === 'node_page', `${label}: 1. the app is told it runs as the node's page (surface ${told?.surface ?? 'none'})`);
  check(told !== null && told.acting_username === c.acting_username && told.install_id === c.install_id && told.node_id === c.node_id && told.app_id === c.app_id,
    `${label}: 1. its context is the transcript's: the acting username, install, node and app the recorded receipt is for (${JSON.stringify(told && [told.acting_username, told.install_id, told.node_id, told.app_id])})`);
  const pane = await box(page.getByTestId('app-page-pane'));
  const node = await box(page.getByTestId('harness-node-pane'));
  const host = await box(page.getByTestId('app-page-host'));
  const canvas = await box(page.getByTestId('app-zone-canvas'));
  check(within(pane, node, 1), `${label}: 1. the page fills the node's pane (${fmt(pane)} of ${fmt(node)})`);
  check(within(host, pane, 1) && within(canvas, host, 1), `${label}: 1. the app's canvas and its host fill the page (canvas ${fmt(canvas)}, host ${fmt(host)}, page ${fmt(pane)})`);
  const chrome = await page.evaluate((ids) => ids.map((id) => [id, document.querySelectorAll(`[data-testid="${id}"]`).length]), DOCUMENT_CHROME);
  const worn = chrome.filter(([, n]) => n > 0);
  check(worn.length === 0, `${label}: 1. no document chrome around it (${worn.length ? worn.map(([id, n]) => `${id} x${n}`).join(', ') : `none of ${DOCUMENT_CHROME.length} test ids present`})`);
  return true;
}

export async function showsTheLinkScreen(page, label, check) {
  const drawn = await until(page, (f) => [...document.querySelectorAll('[data-testid="app-region-overlay"] > *')].some((el) => el.getAttribute('aria-label')?.startsWith(`${f}:`)), LINK_FIELD);
  const list = await regions(page);
  const field = list.find((r) => r.label?.startsWith(`${LINK_FIELD}:`));
  const submit = list.find((r) => r.role === 'button' && r.label === SUBMIT);
  check(drawn && field !== undefined && submit !== undefined, `${label}: 2. first run shows the link screen: the "${LINK_FIELD}" field and the "${SUBMIT}" action as regions (${list.map((r) => `${r.role} "${r.label}"`).join(', ') || 'no regions'})`);
  if (field === undefined) return;
  // From the top of the page, by keyboard alone: the canvas first, then the regions in draw order.
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  let reached = null;
  for (let i = 0; i < 6 && reached === null; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate((id) => (document.activeElement?.getAttribute('data-region-id') === id ? id : null), field.id);
  }
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const s = el instanceof HTMLElement ? getComputedStyle(el) : null;
    const r = el?.getBoundingClientRect();
    return { shadow: s?.boxShadow ?? 'none', outline: s === null ? 'none' : `${s.outlineStyle} ${s.outlineWidth}`, w: r?.width ?? 0, h: r?.height ?? 0 };
  });
  check(reached !== null, `${label}: 2. Tab reaches the "${LINK_FIELD}" region`);
  check(reached !== null && ring.w > 0 && ring.h > 0 && (ring.shadow !== 'none' || !ring.outline.startsWith('none')), `${label}: 2. the focused region shows a focus indicator (box-shadow ${ring.shadow}; outline ${ring.outline}; ${ring.w.toFixed(0)}x${ring.h.toFixed(0)})`);
}

export async function typingTheCodeRedeems(page, label, check, t) {
  // The app reads keys on its canvas (zone-input.ts), the stop before its regions.
  await page.getByTestId('app-zone-canvas').focus();
  await page.keyboard.type(t.link_code, { delay: KEY_DELAY_MS });
  await page.keyboard.press('Enter');
  const sent = await until(page, () => window.__page.agent.mismatch !== null || window.__page.agent.matched.some((m) => m.what === 'redeem'));
  const r = (await record(page)).agent;
  const what = r.mismatch === null ? `sends matched: ${r.matched.map((m) => m.what).join(', ')}` : `at ${r.mismatch.at} the app sent ${r.mismatch.got.slice(0, 48)}… where the transcript has ${r.mismatch.want.slice(0, 48)}…`;
  check(sent && r.mismatch === null && r.matched.some((m) => m.what === 'redeem'), `${label}: 3. "${t.link_code}" and Enter send exactly the recorded redeem (${what})`);
}

export async function catchUpDrawsTheTree(page, label, check, t) {
  const caughtUp = await until(page, (n) => window.__page.agent.mismatch !== null || window.__page.agent.matched.filter((m) => m.what === 'subscribe').length >= n, 1);
  await idle(page, 15_000);
  const want = t.expected.labels_after_catch_up;
  await until(page, (w) => {
    const got = [...document.querySelectorAll('[data-testid="app-region-overlay"] > *')].map((el) => el.getAttribute('aria-label'));
    return w.every((x) => got.filter((g) => g === x).length >= w.filter((y) => y === x).length);
  }, want, 10_000);
  const rested = await framesStopped(page);
  const { settled, list } = await settledRegions(page);
  const r = await record(page);
  check(rested, `${label}: 4. the tree comes to rest: the app stops asking for frames (${r.worker.frames} delivered${rested ? '' : ', still arriving after 10 s'}; the app drew ${r.worker.fromWorker.regions ?? 0} region sets)`);
  const missing = missingFrom(list.map((x) => x.label), want);
  check(caughtUp && r.agent.mismatch === null, `${label}: 4. every recorded step was sent and answered in order (${r.agent.matched.map((m) => m.what).join(', ')}; delivered ${r.agent.delivered.join(', ')})`);
  check(missing.length === 0, `${label}: 4. the tree's regions name every label of the catch-up, duplicates counted (${want.length} wanted, ${list.length} drawn${missing.length ? `; missing ${JSON.stringify(missing)}; the host delivered ${r.worker.frames} frames and the app drew ${r.worker.fromWorker.regions ?? 0}` : ''})`);
  const canvas = await box(page.getByTestId('app-zone-canvas'));
  const outside = list.filter((x) => x.x < canvas.x - 0.5 || x.y < canvas.y - 0.5 || x.x + x.w > canvas.x + canvas.width + 0.5 || x.y + x.h > canvas.y + canvas.height + 0.5);
  const places = new Set(list.map((x) => `${Math.round(x.x)},${Math.round(x.y)}`));
  check(settled && list.length > 0 && outside.length === 0, `${label}: 4. each region lies inside the pane, at rest (${list.length - outside.length} of ${list.length} inside ${fmt(canvas)}${outside.length ? `; outside: ${outside.map((x) => `"${x.label}" ${x.w.toFixed(0)}x${x.h.toFixed(0)}@${x.x.toFixed(0)},${x.y.toFixed(0)}`).join(', ')}` : ''}${settled ? '' : '; still moving'})`);
  check(places.size > 1, `${label}: 4. the regions are laid out, not stacked at one point (${places.size} distinct places)`);
  const foreign = r.agent.requests.filter((x) => !x.startsWith('AppSession'));
  const server = r.server.requests.filter((x) => !(x === 'GetRelease' || x === 'FetchArtifact' || x.startsWith('Call Storage/')));
  check(foreign.length === 0 && server.length === 0, `${label}: 4. no egress of the guest's own: the agent was asked only AppSession* (${r.agent.requests.length} requests${foreign.length ? `; also ${foreign.join(', ')}` : ''}), the server only its release, artifact and storage (${r.server.requests.length}${server.length ? `; also ${server.join(', ')}` : ''})`);
}
