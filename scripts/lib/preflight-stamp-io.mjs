/**
 * The edge of preflight-stamp.mjs: reads and writes stamps and plans a hook over them; the world
 * the keys are computed over is read by preflight-world-io.mjs. Every decision is the pure module's.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decide, drivesABrowser, localImports, parseStamp, stampKey, stampRecord, stampScope, stampsOff } from './preflight-stamp.mjs';
import { readWorld } from './preflight-world-io.mjs';

/** Where this box keeps its stamps: outside every git tree, so no checkout or clean can carry one. */
export const STAMP_DIR = join(homedir(), '.cache', 'citadel-preflight', 'stamps');

/**
 * Whether a gate script drives a browser or a built bundle, from its local import closure.
 * An import that cannot be found ends that branch: an unproven gate is unstamped, so it runs.
 * @param {string} root @param {string} script relative to root @returns {boolean}
 */
export function scriptDrivesABrowser(root, script) {
  const seen = new Set();
  const queue = [resolve(root, script)];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    if (drivesABrowser(source)) return true;
    for (const spec of localImports(source)) {
      const target = [spec, `${spec}.mjs`, `${spec}.js`].map((s) => resolve(dirname(file), s)).find((p) => existsSync(p) && statSync(p).isFile());
      if (target) queue.push(target);
    }
  }
  return false;
}

/** Refuses a stamp directory inside any git tree (a clean, a checkout or a commit could carry it). */
export function assertOutsideGit(dir) {
  for (let p = resolve(dir); ; p = dirname(p)) {
    if (existsSync(join(p, '.git'))) throw new Error(`stamp directory ${dir} is inside the git tree at ${p}; stamps must live outside every checkout`);
    if (dirname(p) === p) return;
  }
}

/** @param {string} dir @param {string} key @returns {import('./preflight-stamp.mjs').StampRecord|null} */
export function readStamp(dir, key) {
  const path = join(dir, `${key}.json`);
  if (!existsSync(path)) return null;
  return parseStamp(readFileSync(path, 'utf8'), key, path);
}

/** A stamp, or why it could not be read: a corrupt or unreadable stamp runs the gate and is overwritten by its pass. */
function storedStamp(dir, key) {
  try {
    return { record: readStamp(dir, key), unreadable: null };
  } catch (error) {
    return { record: null, unreadable: error.message };
  }
}

/** Writes a pass atomically: a half-written stamp would be an error on the next read, not a pass. */
export function writeStamp(dir, record) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${record.key}.json`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record)}\n`);
  renameSync(tmp, path);
}

/**
 * dist/ older than the newest file under src/: the browser gates then test an older bundle.
 * A warning only; nothing builds dist/ for the hooks. @returns {string|null}
 */
export function distStaleness(root) {
  const index = join(root, 'citadel-workspaces', 'dist', 'index.html');
  if (!existsSync(index)) return 'citadel-workspaces/dist/index.html does not exist; the browser gates have no bundle to serve';
  let newest = { at: 0, path: '' };
  const scan = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) scan(full);
      else if (st.mtimeMs > newest.at) newest = { at: st.mtimeMs, path: full };
    }
  };
  scan(join(root, 'citadel-workspaces', 'src'));
  const built = statSync(index).mtimeMs;
  if (newest.at <= built) return null;
  const hours = ((newest.at - built) / 3600000).toFixed(1);
  return `citadel-workspaces/dist is ${hours} h older than ${relative(root, newest.path)}; the browser gates test that older bundle (run npm run build in citadel-workspaces)`;
}


/** Where the last tier run's world is kept for this checkout, so a stamp miss can say what moved. */
const worldFile = (dir, root) => join(dir, 'worlds', `${createHash('sha256').update(resolve(root)).digest('hex')}.json`);

/** The world the last recorded tier saw in this checkout, or null. Only ever used for a message. */
export function lastWorld(dir, root) {
  try {
    return JSON.parse(readFileSync(worldFile(dir, root), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Decides every selected check: run it, or skip it on a pass stamped over the same key.
 * @returns {{ off: string|null, world: object|null, browser: boolean, plan: { check: object, key: string|null, decision: ReturnType<typeof decide> }[] }}
 */
export function planStamps({ root, checks, tier, env, dir, now }) {
  const browser = checks.some((c) => typeof c.script === 'string' && scriptDrivesABrowser(root, c.script));
  const unstamped = (check) => ({ check, key: null, decision: decide({ stampable: false, record: null, unreadable: null, now }) });
  const runAll = (off) => ({ off, world: null, browser, plan: checks.map(unstamped) });
  const off = stampsOff(tier, env);
  if (off !== null) return runAll(off);
  assertOutsideGit(dir);
  const world = readWorld(root, env);
  if ('unkeyable' in world) return runAll(`this tree cannot be keyed (${world.unkeyable})`);
  const plan = checks.map((check) => {
    const cwd = relative(root, check.cwd);
    const scope = stampScope(check, cwd);
    if (scope === null) return unstamped(check);
    const key = stampKey(scope === 'agent' ? world.agentDigest : world.digest, { cmd: check.cmd, args: check.args, cwd, env: check.env });
    return { check, key, decision: decide({ stampable: true, ...storedStamp(dir, key), now }) };
  });
  return { off: null, world, browser, plan };
}

/**
 * Records the passes, but only if the world is still the one their keys describe: a gate that
 * wrote into the tree while it ran passed over inputs that no longer exist.
 * @param {{ root: string, env: Record<string, string|undefined>, dir: string, world: { digest: string, entries: [string, string][] }, hook: string,
 *   passes: { key: string, name: string, ms: number }[], now: number }} input
 * @returns {string} what was recorded, for the log
 */
export function recordPasses({ root, env, dir, world, hook, passes, now }) {
  if (passes.length === 0) return 'no stampable gate passed; nothing recorded';
  const after = readWorld(root, env);
  if ('unkeyable' in after || after.digest !== world.digest) return `stamps NOT recorded: the tree changed while the gates ran`;
  for (const { key, name, ms } of passes) writeStamp(dir, stampRecord(key, name, hook, now, ms));
  mkdirSync(dirname(worldFile(dir, root)), { recursive: true });
  writeFileSync(worldFile(dir, root), JSON.stringify(world.entries));
  return `${passes.length} pass(es) stamped in ${dir}`;
}
