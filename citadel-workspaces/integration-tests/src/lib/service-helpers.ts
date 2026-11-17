/**
 * Service Helper Functions
 *
 * Utilities for managing backend services during integration tests.
 * These functions use tilt to restart services and ensure clean state.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { sleep, waitForServicesAlive } from './utils.js';

/**
 * How long to let the stack come back before calling it broken.
 *
 * Generous on purpose: the server takes noticeably longer to start once a run
 * has built up workspaces and accounts, and a premature failure here aborts a
 * spec for reasons that have nothing to do with what it was testing.
 */
const CONTAINER_READY_TIMEOUT_MS = 300_000;
const CONTAINER_POLL_INTERVAL_MS = 2_000;

/**
 * How many times to nudge a container that has exited.
 *
 * More than one, because the server does not always come back on the first
 * restart: it has been observed exiting, staying exited through one restart,
 * and then coming up healthy later. Spaced out rather than immediate, so a
 * container that is simply slow is not restarted out from under itself.
 */
const MAX_CONTAINER_RESTARTS = 4;

/**
 * Gap between restart attempts.
 *
 * The common failure is the server exiting with "Address already in use (os
 * error 98)" because the previous process has not released the port yet.
 * Restarting again immediately just reproduces it, so the gap has to be long
 * enough for the socket to clear — this is waiting on the OS, not on the app.
 */
const RESTART_BACKOFF_MS = 25_000;

/**
 * Get the workspace root directory dynamically.
 * This resolves from integration-tests/src/lib/service-helpers.ts up 3 levels.
 */
export function getWorkspaceRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', '..');
}

/**
 * Restart backend services (server and internal-service) to ensure clean state.
 *
 * This is necessary before tests that depend on admin permissions, since:
 * - The admin user is the first user to join the workspace
 * - If previous test runs left stale state, new users may not get admin role
 *
 * Uses docker compose restart to fully restart containers with clean in-memory state.
 *
 * Takes no timing options. It used to accept a `restartTime` to sleep for, which
 * callers had to guess at; it now waits on the containers' own health status,
 * so it returns as soon as the stack is genuinely up and does not need tuning.
 */
export async function restartBackendServices(): Promise<void> {
  const cwd = getWorkspaceRoot();

  console.log('\n' + '='.repeat(60));
  console.log('RESTARTING BACKEND SERVICES FOR CLEAN STATE');
  console.log('='.repeat(60));

  const startTime = Date.now();

  try {
    // RECREATE, not restart.
    //
    // `docker restart` resets the process but keeps the container's writable
    // layer, so anything a spec wrote to disk survives it. The workspace's
    // default MDX lives at /usr/src/app/documents inside the image, and a spec
    // that edits an office rewrites it — so "clean state" reset the in-memory
    // accounts and sessions while silently carrying document edits into every
    // later run. node-content-propagation overwrote the General office, which
    // deleted the bullet list the accessibility suite measures for contrast,
    // and "workspace shell in light mode" then failed several specs later with
    // nothing to connect it to the cause. It looked exactly like flake.
    //
    // --no-deps keeps this from dragging in sync-wasm-client, which is the
    // dependency chain `docker compose restart` was originally avoided for.
    // --force-recreate discards the writable layer, which is the point.
    console.log('\n  Recreating server container...');
    execSync('docker compose up -d --force-recreate --no-deps server', {
      stdio: 'inherit',
      timeout: 120000,
      cwd,
    });

    console.log('  Recreating internal-service container...');
    execSync('docker compose up -d --force-recreate --no-deps internal-service', {
      stdio: 'inherit',
      timeout: 120000,
      cwd,
    });

    // Wait for both containers to report healthy, polling the real state rather
    // than sleeping a fixed 10s and then checking three times in a row with no
    // gap between the attempts.
    //
    // That older shape is what made this fail: after `docker restart` it
    // re-read `docker compose ps` immediately, so a container still coming up
    // read as `exited`, it "recovered" it with another restart, checked again
    // with no delay, and gave up after three rounds — while the server was in
    // fact fine moments later. Health is the signal the compose file already
    // defines; waiting on it returns as soon as the stack is genuinely ready
    // and tolerates a slow start without hiding a real crash.
    console.log('  Waiting for containers to report healthy...');

    const deadline = Date.now() + CONTAINER_READY_TIMEOUT_MS;
    let lastState = '';
    let restarts = 0;
    let nextRestartAllowedAt = 0;

    for (;;) {
      const psOutput = execSync(
        'docker compose ps -a --format json server internal-service',
        { cwd, timeout: 10000 }
      ).toString();

      const containers = psOutput.trim().split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as { Service: string; State: string; Health?: string });

      const server = containers.find(c => c.Service === 'server');
      const internal = containers.find(c => c.Service === 'internal-service');

      // Health is empty for containers without a healthcheck; treat running as
      // sufficient there rather than waiting for a status that never arrives.
      const ready = (c?: { State: string; Health?: string }) =>
        c?.State === 'running' && (!c.Health || c.Health === 'healthy');

      const state = `server=${server?.State}/${server?.Health || 'no-healthcheck'}, ` +
        `internal-service=${internal?.State}/${internal?.Health || 'no-healthcheck'}`;
      if (state !== lastState) {
        console.log(`    ${state}`);
        lastState = state;
      }

      if (ready(server) && ready(internal)) break;

      // A container that has exited will not recover on its own. Nudge it, but
      // leave a gap between attempts so a merely slow container is not
      // restarted out from under itself.
      const exited = server?.State === 'exited' || internal?.State === 'exited';
      if (exited && restarts < MAX_CONTAINER_RESTARTS && Date.now() >= nextRestartAllowedAt) {
        restarts += 1;
        nextRestartAllowedAt = Date.now() + RESTART_BACKOFF_MS;
        // Name the bind failure when it is the cause; it looks like a crash
        // otherwise and sends people looking at the wrong thing.
        let why = '';
        try {
          const recent = execSync('docker compose logs --tail=20 server', { cwd, timeout: 15000 }).toString();
          if (/Address already in use/.test(recent)) why = ' (port not released yet)';
        } catch { /* the log is a nicety here, not worth failing over */ }
        console.log(`  A container exited${why}; restart attempt ${restarts}/${MAX_CONTAINER_RESTARTS}...`);
        if (server?.State === 'exited') {
          execSync('docker restart --timeout 15 citadel-workspace-server-1', { stdio: 'inherit', timeout: 60000 });
        }
        if (internal?.State === 'exited') {
          execSync('docker restart --timeout 15 citadel-workspace-internal-service-1', { stdio: 'inherit', timeout: 60000 });
        }
      }

      if (Date.now() > deadline) {
        // Print what the container itself said. "server=exited" names the
        // symptom; the log names the cause, and without it the next person is
        // left re-running the suite to find out.
        let tail = '';
        try {
          tail = execSync('docker compose logs --tail=40 server internal-service', {
            cwd, timeout: 20000,
          }).toString();
        } catch {
          tail = '(could not read container logs)';
        }
        throw new Error(
          `Containers did not become healthy within ${CONTAINER_READY_TIMEOUT_MS / 1000}s ` +
          `after ${restarts} restart attempt(s). Last seen: ${state}\n\n${tail}`
        );
      }

      await sleep(CONTAINER_POLL_INTERVAL_MS);
    }

    // Now verify services respond via TCP
    console.log('  Verifying services are responding...');
    await waitForServicesAlive(60000, 2000);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n  Services restarted successfully in ${elapsed}s`);
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('  ERROR: Failed to restart backend services');
    console.error('  ', error);
    throw error;
  }
}
