/**
 * check-app-page.mjs, second half: the member's agent holds the app's session across a reload of
 * the page (5), the recorded join arrives as exactly one host notification that opens the app's
 * node, and the tree at rest after it names the recorded labels (6), and the live page is accessible (7).
 */
import { AxeBuilder } from '@axe-core/playwright';
import { framesStopped, idle, missingFrom, record, settledRegions, until } from './probe.mjs';

const opensFor = (r, server) => r.agent.opens.filter((o) => o.server === server);
/** The tail's NOTIFY is delivered this many times (the host must still show one notification). */
const NOTIFY_TIMES = 2;

export async function theAgentHoldsTheSession(page, label, check, t) {
  const { server, install_id: install, acting_username: me } = t.context;
  const before = await record(page);
  const first = opensFor(before, server);
  check(before.agent.opens.length === 1 && first.length === 1 && first[0].installId === install && first[0].actingUsername === me,
    `${label}: 5. one AppSessionOpen, for ${server} as ${me} on ${install} (${JSON.stringify(before.agent.opens.map((o) => [o.server, o.actingUsername, o.installId]))})`);
  await page.evaluate(() => window.__page.remount());
  const reopened = await until(page, () => window.__page.agent.mismatch !== null || window.__page.agent.matched.filter((m) => m.open === 2).length >= 2);
  await idle(page, 15_000);
  const after = await record(page);
  const second = after.agent.opens[1];
  check(reopened && second !== undefined && second.cid === first[0]?.cid && second.installId === install && second.actingUsername === me && second.server === server,
    `${label}: 5. the page reloaded opens the session again, for the same member, install and person (${second === undefined ? 'no second open' : JSON.stringify([second.cid, second.installId, second.actingUsername, second.server])})`);
  check(second !== undefined && second.answeredState === 'connected' && second.answeredServerCid === first[0]?.answeredServerCid && second.answeredServerCid === t.session.cid,
    `${label}: 5. the agent answers it connected, with the account it already holds (server_cid ${first[0]?.answeredServerCid} then ${second?.answeredServerCid ?? 'none'}; the transcript's ${t.session.cid})`);
  const resent = after.agent.matched.filter((m) => m.open === 2).map((m) => m.what);
  check(after.agent.mismatch === null && resent.join(',') === 'hello,subscribe',
    `${label}: 5. linked already, it greets and subscribes again with the recorded bytes and redeems nothing (${resent.join(', ') || 'nothing'}${after.agent.mismatch ? `; mismatch at ${after.agent.mismatch.at}` : ''})`);
  check(after.server.requests.filter((x) => x === 'Call Storage/KvSet').length === 1, `${label}: 5. the link is written once, on the first run (${after.server.requests.filter((x) => x.startsWith('Call ')).join(', ')})`);
}

export async function theJoinIsOneNotification(page, label, check, t) {
  const want = t.expected.notification;
  const eventsBefore = (await record(page)).worker.eventsDone;
  await page.evaluate((n) => window.__page.playTail(n), NOTIFY_TIMES);
  await idle(page, 15_000);
  await until(page, () => window.__page.notices.entries.length > 0, undefined, 5_000);
  const r = await record(page);
  const e = r.notices.entries;
  check(r.worker.notifyCalls === 1 && e.length === 1, `${label}: 6. the NOTIFY, delivered twice, is one notification (guest notify calls ${r.worker.notifyCalls}, entries ${e.length})`);
  check(e.length === 1 && e[0].from === t.context.server && e[0].title === want.title && e[0].body === want.body,
    `${label}: 6. it is from ${t.context.server}, with the recorded title and body (${JSON.stringify(e)})`);
  if (e.length > 0) {
    await page.getByTestId('harness-notices').getByText(want.title, { exact: true }).first().click();
    // The opener navigates in a transition (react-router 7 makes every navigation one), so the
    // location is read once it has moved, not in the same tick as the event.
    const opened = await until(page, (node) => window.__page.openNode.includes(node)
      && window.__page.notices.location.includes(`nodeId=${node}`), t.context.node_id, 5_000);
    const now = await record(page);
    check(opened && now.openNode.length === 1 && now.notices.location.includes(`nodeId=${t.context.node_id}`),
      `${label}: 6. activating its card opens the app's node (apps:open-node ${JSON.stringify(now.openNode)}; location ${now.notices.location})`);
  }
  // As in 4: the overlay is read once the app has stopped asking for frames. An overlay that
  // merely holds still can be a draw the app's call budget is holding back, not the tree at rest.
  const rested = await framesStopped(page);
  const { settled, list } = await settledRegions(page);
  const w = (await record(page)).worker;
  // Each tail delivery is one event to the app; the overlay counts as "after the join" only once all are done.
  const deliveries = t.tail.reduce((n, step) => n + (step.what === 'notify' ? NOTIFY_TIMES : 1), 0);
  const handled = w.eventsDone - eventsBefore;
  const labels = list.map((x) => x.label);
  const extra = missingFrom(t.expected.labels_after_join, labels);
  const missing = missingFrom(labels, t.expected.labels_after_join);
  check(handled >= deliveries && rested && settled && missing.length === 0 && extra.length === 0, `${label}: 6. after the join the tree comes to rest with the recorded labels (the app handled ${handled} of the tail's ${deliveries} deliveries; ${labels.length} of ${t.expected.labels_after_join.length}${missing.length ? `; missing ${JSON.stringify(missing)}` : ''}${extra.length ? `; extra ${JSON.stringify(extra)}` : ''}; ${w.frames} frames delivered, ${w.fromWorker.regions ?? 0} region sets drawn${rested ? '' : ', still arriving after 10 s'}${settled ? '' : ', overlay still moving'})`);
}

export async function theLivePageIsAccessible(page, label, check) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle' || a.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout: 5_000 }).catch(() => undefined);
  const { list } = await settledRegions(page);
  const unnamed = list.filter((x) => (x.label ?? '').trim() === '');
  check(list.length > 0 && unnamed.length === 0, `${label}: 7. every region has an accessible name (${list.length - unnamed.length} of ${list.length})`);
  const axe = await new AxeBuilder({ page }).include('[data-testid="app-page-pane"]').analyze();
  const serious = axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical');
  check(serious.length === 0, `${label}: 7. axe finds nothing serious in the page (${axe.passes.length} rules passed${serious.length ? `; ${serious.map((x) => `${x.id} on ${x.nodes.length}`).join(', ')}` : ''})`);
}
