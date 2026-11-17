/**
 * The workspace server made unreachable for the length of a step, without losing its state.
 *
 * Paused, not stopped: the server keeps its accounts in memory, and a stop or recreate wipes
 * every account the later specs in the shard sign in with. A paused container answers nothing,
 * which from the agent's side is the same as a server that cannot be reached.
 *
 * Waits on what the page shows, never on a sleep: the agent reports the loss only once its
 * keepalive gives up, and the page shows it (server-reconnecting-banner) once that report
 * arrives. After the unpause it waits for the banner to go, so the next step finds a live server.
 */
import { execSync } from 'child_process';
import { expect, type Locator, type Page } from '@playwright/test';
import { getWorkspaceRoot } from './service-helpers.js';

/** How long the agent may take to give up on a silent server, and then to bring it back. */
const LOSS_REPORTED_WITHIN_MS: number = 180_000;
const RECONNECTED_WITHIN_MS: number = 180_000;

const compose = (verb: 'pause' | 'unpause'): void => {
  execSync(`docker compose ${verb} server`, { stdio: 'inherit', timeout: 60_000, cwd: getWorkspaceRoot() });
};

export async function withServerUnreachable<T>(page: Page, step: () => Promise<T>): Promise<T> {
  const banner: Locator = page.getByTestId('server-reconnecting-banner');
  compose('pause');
  let result: T;
  try {
    await expect(banner, 'the agent should report the server link lost').toBeVisible({ timeout: LOSS_REPORTED_WITHIN_MS });
    result = await step();
    // Seen just before the unpause, so its going away afterwards is the reconnect, not a banner
    // that was never there (a wait for absence passes at once on a locator that never matched).
    await expect(banner, 'the link should still be down when the step ends').toBeVisible();
  } finally {
    compose('unpause');
  }
  await expect(banner, 'the agent should bring the server link back').toHaveCount(0, { timeout: RECONNECTED_WITHIN_MS });
  return result;
}
