/**
 * The world a browser-driving gate measures.
 *
 * `vite preview` proxies `/ws` to `127.0.0.1:${AGENT_PORT ?? 12345}`. On a
 * developer's machine that is their live stack; in CI it is nothing at all. So a
 * gate that spawns the preview and says nothing about the agent measures two
 * different applications depending on where it runs — and the difference is not
 * subtle. With no agent the "Connection Failed" modal opens over whatever screen
 * is showing and traps focus, so assertions scoped to `[role="dialog"]` land on
 * the modal rather than the screen they name.
 *
 * That cost a red CI leg and a wrong-surface bug in `check-accessibility.mjs`
 * (round 223). Four more gates had the same shape. The world is pinned here, in
 * one place, so the sixth gate inherits it instead of re-deciding it.
 */
import { spawn } from 'node:child_process';

/** Nothing listens here. Deliberate: see above. */
export const CLOSED_AGENT_PORT = 12399;

/**
 * `vite preview` with the agent port pinned closed.
 *
 * Same signature as the `spawn` call it replaces, minus the decision.
 */
export function spawnPreview(appRoot, port) {
  return spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: appRoot,
    stdio: 'ignore',
    env: { ...process.env, AGENT_PORT: String(CLOSED_AGENT_PORT) },
  });
}

/**
 * Wait for the "Connection Failed" modal and dismiss it.
 *
 * WAIT, do not sample: with the port closed it always arrives, a few seconds
 * after the load. Polling for its absence exits before it shows up on a quick
 * surface and after it shows up on a slow one, so half a run gets measured with
 * it open and half without — which is drift, not a check.
 *
 * Dismissal holds for the rest of the load: the retry state preserves it and
 * only a successful connection clears it. Measured over 30s of continued
 * failure.
 */
export async function dismissConnectionFailure(page, { timeout = 60_000 } = {}) {
  // Once per DOCUMENT, and the document itself is what remembers.
  //
  // Dismissal lasts for the life of the page, so a second call on the same load
  // would wait sixty seconds for a modal that is never coming back. A counter in
  // this module would have to know when the page navigated; a marker on `window`
  // does not — navigation clears it, which is precisely the condition under
  // which the modal returns.
  const alreadyDismissed = await page
    .evaluate(() => window.__retryModalDismissed === true)
    .catch(() => false);
  if (alreadyDismissed) return;

  const modal = page.getByTestId('connection-retry-modal');
  await modal.waitFor({ state: 'visible', timeout });
  // By testid: addressing it as "the last Cancel button" clicks whichever
  // Cancel came last in the DOM, which on the sign-in and settings screens is
  // the underlying dialog's -- closing the screen under test and leaving the
  // modal standing.
  await page.getByTestId('connection-retry-cancel').click();
  await modal.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.evaluate(() => { window.__retryModalDismissed = true; }).catch(() => {});
}

/** The topmost dialog, or the document. Dialogs stack; the top one is the one the user is in. */
export const SCOPE_HELPER = () => {
  window.__gateScope = () => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    return dialogs[dialogs.length - 1] ?? document.body;
  };
};
