/**
 * A foreground `docker compose up` must fail when the container it runs fails.
 *
 * `docker compose up <service>` in the foreground exits 0 whatever the container's
 * own exit status, unless it is told otherwise with `--exit-code-from <service>`
 * (or `--abort-on-container-exit`). The one-shot `sync-wasm-client` container is
 * run exactly that way, and it wipes the WASM output before it rebuilds: when it
 * died half-way (a script missing from its image, 2026-10-01) the step read green
 * and the failure surfaced two steps later as an EISDIR in the bundle budget.
 *
 * Detached starts (`up -d`) are not covered here: `--wait` reports their health,
 * and check-service-logs-are-captured bounds them.
 *
 * Reads the workflow files as text, dependency-free, like the other workflow
 * gates (see check-service-logs-are-captured for why), and asserts it found the
 * calls it expects, so a rename cannot leave it checking nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['.github/workflows', 'citadel-workspaces/.github/workflows'];

/** Every foreground compose `up` in `text`, as `{ line, cmd }`. Pure. */
export function foregroundUps(text) {
  const found = [];
  text.split('\n').forEach((raw, i) => {
    const cmd = raw.replace(/^\s*(run:\s*)?/, '').replace(/\s+#.*$/, '');
    if (cmd.startsWith('#') || !/\bdocker compose\b/.test(cmd) || !/\sup(\s|$)/.test(cmd)) return;
    if (/\s(-d|--detach)(\s|$)/.test(cmd)) return;
    found.push({ line: i + 1, cmd: cmd.trim() });
  });
  return found;
}

/** Whether a foreground `up` propagates its container's exit status. Pure. */
export function keepsExitStatus(cmd) {
  return /--exit-code-from\s+\S+/.test(cmd) || /--abort-on-container-exit\b/.test(cmd);
}

function main() {
  let calls = 0;
  const bad = [];
  for (const dir of DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((n) => /\.ya?ml$/.test(n))) {
      for (const up of foregroundUps(readFileSync(join(abs, f), 'utf8'))) {
        calls++;
        if (!keepsExitStatus(up.cmd)) bad.push(`${dir}/${f}:${up.line}: ${up.cmd}`);
      }
    }
  }
  if (calls < 2) {
    console.error(`found ${calls} foreground docker compose up call(s); expected at least 2 (the sync-wasm-client steps). Has the pattern moved?`);
    process.exit(1);
  }
  if (bad.length) {
    console.error('A foreground `docker compose up` exits 0 when its container fails. Add --exit-code-from <service>:');
    for (const b of bad) console.error(`  ${b}`);
    process.exit(1);
  }
  console.log(`compose up: ${calls} foreground call(s), every one keeps its container's exit status.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
