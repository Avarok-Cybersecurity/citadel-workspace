/**
 * Utility functions for integration tests
 */

import * as net from 'net';
import { config } from './config.js';

/**
 * Sleep for specified milliseconds
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a unique test ID based on timestamp
 */
export function generateTestId(prefix = 'test'): string {
  return `${prefix}_${Date.now()}`;
}

/**
 * Check if a TCP port is open (works for HTTP and WebSocket services)
 */
export async function isTcpPortOpen(host: string, port: number, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Check if a service is alive (supports both HTTP and WebSocket services)
 */
export async function isServiceAlive(url: string, timeout = 5000): Promise<boolean> {
  const urlObj = new URL(url);
  const host = urlObj.hostname;
  const port = parseInt(urlObj.port) || (urlObj.protocol === 'https:' ? 443 : 80);
  return isTcpPortOpen(host, port, timeout);
}

/**
 * Wait for backend services to be alive
 */
export async function waitForServicesAlive(timeout = 180000, pollInterval = 2000): Promise<boolean> {
  console.log('\n=== Waiting for services to be alive ===');
  const startTime = Date.now();

  // Check both UI and internal service
  const services = [
    { name: 'UI', url: config.BASE_URL },
    { name: 'Internal Service', url: config.INTERNAL_SERVICE_URL },
  ];

  while (Date.now() - startTime < timeout) {
    const results = await Promise.all(
      services.map(async (svc) => ({
        name: svc.name,
        alive: await isServiceAlive(svc.url, 3000),
      }))
    );

    const allAlive = results.every(r => r.alive);

    if (allAlive) {
      console.log('  All services are alive:');
      results.forEach(r => console.log(`    ${r.name}: OK`));
      // Give backend services time to fully initialize WebSocket handlers
      console.log('  Waiting 5s for backend initialization...');
      await sleep(5000);
      return true;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  Waiting... (${elapsed}s elapsed)`);
    results.forEach(r => {
      console.log(`    ${r.name}: ${r.alive ? 'OK' : 'waiting...'}`);
    });

    await sleep(pollInterval);
  }

  throw new Error(`Services did not become alive within ${timeout / 1000}s`);
}

/**
 * Whether `locator` becomes visible within `timeout`.
 *
 * Use this instead of `locator.isVisible({ timeout })`. Playwright IGNORES the
 * timeout option on isVisible — it is an immediate snapshot, not a wait. This
 * suite used that form 595 times believing it polled, which is the reason nearly
 * every interaction had to be padded with a sleep to work at all: the check ran
 * before the UI had responded, returned false, and the sleep was added to make it
 * pass rather than to make it correct.
 *
 * Returns as soon as the element appears, so the timeout is a ceiling rather than
 * a cost.
 */
export async function isVisibleWithin(
  locator: { waitFor: (opts: { state: 'visible'; timeout: number }) => Promise<void> },
  timeout: number
): Promise<boolean> {
  return locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
}

/**
 * Whether `locator` is gone (hidden or detached) within `timeout`.
 *
 * Checking for absence with `!(await isVisibleWithin(...))` spends the whole
 * timeout waiting for something that is never going to appear. This waits for the
 * opposite state and returns the moment it holds.
 */
export async function isHiddenWithin(
  locator: { waitFor: (opts: { state: 'hidden'; timeout: number }) => Promise<void> },
  timeout: number
): Promise<boolean> {
  return locator.waitFor({ state: 'hidden', timeout }).then(() => true).catch(() => false);
}

/**
 * Wait for a condition the DOM does not express as a locator state.
 *
 * `isVisibleWithin` covers "is it there"; a lot of checks are about something
 * else — a switch that has flipped, a counter that has moved, a URL that has
 * changed. Those were written as `await sleep(N)` and then one read, which is a
 * guess at how long the app takes and reports the product as broken when the
 * guess is short. Fifty-four such sleeps sit in front of a reported PASS/FAIL
 * in this suite; most are padding before a real wait, and the ones that are not
 * decide a result from a number in the test.
 *
 * Returns as soon as the predicate holds, or false at the deadline.
 */
export async function pollUntil(
  predicate: () => Promise<boolean>,
  timeout: number,
  intervalMs: number = 100,
): Promise<boolean> {
  const deadline: number = Date.now() + timeout;
  for (;;) {
    if (await predicate().catch((): boolean => false)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve): void => { setTimeout(resolve, intervalMs); });
  }
}
