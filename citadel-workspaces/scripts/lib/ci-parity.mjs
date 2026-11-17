/**
 * CI_PARITY=1: a local geometry or harness run that sees the machine a CI runner is.
 *
 * Animations=Auto picks Lite on a device reporting four cores or fewer (lib/motion-tier.ts,
 * SLOW_AT_MOST), and Chromium on CI's 4-core runners reports four, so CI measured Lite while a
 * dev Mac measured Full and the two disagreed about the same commit. Parity mode makes every
 * browser context this harness opens report the runner instead, throttles the CPU the way
 * POLISH_CPU_THROTTLE does, and refuses to run on a Node CI does not use.
 *
 * It reproduces: navigator.hardwareConcurrency 4 and navigator.deviceMemory 8 (a 16 GB runner,
 * which Chromium buckets to 8), so Auto resolves as on CI; a 4x CPU slowdown in Chromium; the
 * Node major. It does NOT reproduce: the Docker stack (nothing here starts it), Linux font
 * rasterisation or Windows, real network latency, or WebKit throttling (CDP is Chromium's).
 *
 * A scenario that PINS a tier keeps it: the sidebar harness sets Animations to full, lite or off
 * explicitly, and appMotionTier only consults the device under Auto, so only Auto moves.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** GitHub's ubuntu-latest runner for a public repository: 4 vCPU, 16 GB. */
export const CI_RUNNER = { hardwareConcurrency: 4, deviceMemory: 8, cpuThrottle: 4 };

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Whether parity mode is on. Any value but `1` or unset is a mistake, not a "no". */
export function parityEnabled() {
  const value = process.env.CI_PARITY;
  if (value === undefined || value === '') return false;
  if (value !== '1') throw new Error(`CI_PARITY must be 1 or unset; got '${value}'`);
  return true;
}

/** The CPU slowdown to apply: POLISH_CPU_THROTTLE when set, else the runner's under parity, else none. */
export function cpuThrottle() {
  const explicit = process.env.POLISH_CPU_THROTTLE;
  if (explicit !== undefined && explicit !== '') {
    const rate = Number(explicit);
    if (!Number.isFinite(rate) || rate < 1) throw new Error(`POLISH_CPU_THROTTLE must be a number >= 1; got '${explicit}'`);
    if (parityEnabled() && rate !== CI_RUNNER.cpuThrottle) {
      throw new Error(`CI_PARITY=1 throttles ${CI_RUNNER.cpuThrottle}x, and POLISH_CPU_THROTTLE asks for ${rate}x; unset one`);
    }
    return rate;
  }
  return parityEnabled() ? CI_RUNNER.cpuThrottle : 1;
}

let announced = false;

/** Under parity: assert the Node major against CI's (the parent's gate) and say what is emulated. Once per process. */
export function assertParity() {
  if (!parityEnabled() || announced) return;
  announced = true;
  const gate = join(UI_ROOT, '..', 'scripts', 'check-node-matches-ci.mjs');
  if (!existsSync(gate)) throw new Error(`CI_PARITY=1 needs the parent checkout around this repo (looked for ${gate})`);
  const run = spawnSync(process.execPath, [gate], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`CI_PARITY=1: ${`${run.stdout}${run.stderr}`.trim()}`);
  console.log(`  CI parity: hardwareConcurrency ${CI_RUNNER.hardwareConcurrency}, deviceMemory ${CI_RUNNER.deviceMemory}, ` +
    `CPU ${cpuThrottle()}x (Chromium), Node ${process.versions.node}. Not reproduced: Docker stack, Linux/Windows rendering.`);
}

/** browser.newContext, plus -- under parity -- the runner's navigator and CPU. */
export async function newParityContext(browser, options) {
  const context = await browser.newContext(options);
  if (!parityEnabled()) return context;
  const { hardwareConcurrency, deviceMemory } = CI_RUNNER;
  await context.addInitScript(({ cores, memory }) => {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => cores, configurable: true });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => memory, configurable: true });
  }, { cores: hardwareConcurrency, memory: deviceMemory });
  const rate = cpuThrottle();
  if (rate > 1 && browser.browserType().name() === 'chromium') {
    context.on('page', (page) => {
      // A page closed before its session opened has nothing left to slow; anything else is loud.
      void context.newCDPSession(page).then((cdp) => cdp.send('Emulation.setCPUThrottlingRate', { rate })).catch((error) => {
        if (!page.isClosed()) throw error;
      });
    });
  }
  return context;
}
