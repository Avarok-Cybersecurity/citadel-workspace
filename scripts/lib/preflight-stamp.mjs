/**
 * Pass stamps: a gate that already passed on THIS box over byte-identical inputs is not re-run
 * by the next hook. Pure: the key, the decision and the record format. The reads and writes are
 * in preflight-stamp-io.mjs.
 *
 * One release fix ran four hooks back to back (UI pre-commit, UI pre-push, the parent's
 * pre-commit and pre-push of the pointer bump) and each ran the same ~11.5 min browser battery
 * over the same tree. CI still runs every gate; only a local re-run over identical inputs that
 * already passed here is skipped, and only passes are ever recorded.
 *
 * The key is the WORLD (every tracked and untracked, non-ignored file of the checkout and its
 * submodules by content, the ignored build outputs the gates read, the installed toolchain and
 * the environment) plus the gate's own argv, directory and env. Wider than any one gate reads,
 * on purpose: a key that misses an input is a false pass, a key that is too wide is a re-run.
 */
import { createHash } from 'node:crypto';

/** Bumped whenever what goes into a key changes, so an older stamp can never match. */
export const STAMP_FORMAT = 2;

/** A stamp older than this is ignored: date-dependent tests, browser caches, a day's drift. */
export const STAMP_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Environment the key leaves out, BY NAME, each with where it comes from. Everything else is in
 * the key -- CARGO_*, RUSTFLAGS, NODE_OPTIONS, CI, CITADEL_*, SDKROOT, CPATH -- so an unknown or
 * changed variable re-runs the gate rather than being trusted.
 *
 * Measured on Apple git 2.54 (scratch hooks, REL-1124): `git push` and `git hook run` hand a hook
 * the same environment; a shell differs from both by GIT_EXEC_PATH (and its PATH prefix, see
 * pathWithoutGitExecPath), GIT_PREFIX, and the xcrun shim's SDKROOT, CPATH, MANPATH and an extra
 * LIBRARY_PATH entry. The shim's variables stay IN the key (SDKROOT picks the C SDK a build script
 * compiles against): a tier is run through `git hook run` (lib/preflight-push.mjs) precisely so
 * that they match the push.
 */
/**
 * Git hands a hook the variables that locate ITS repository. Inherited by a gate that runs git
 * in another repo, they silently point that gate at the wrong index and object store, so
 * lib/preflight-run.mjs strips them from every gate; for the same reason they are not inputs.
 */
export const REPO_LOCATORS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];
const GIT_HOOK_VARIABLES = [
  'GIT_EXEC_PATH', 'GIT_PREFIX', // every hook: git's own exec dir, and the subdirectory git was started in
  ...REPO_LOCATORS.filter((name) => name !== 'GIT_PREFIX'),
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_EDITOR', 'GIT_REFLOG_ACTION', // pre-commit / pre-merge-commit: the commit being made
  'GIT_PUSH_OPTION_COUNT', // pre-push with `-o`; the options themselves match GIT_PUSH_OPTION_<n> below
  'GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_SSH_VARIANT', // transport only: lanes set a keep-alive for the push alone
];
const SHELL_BOOKKEEPING = ['PWD', 'OLDPWD', 'SHLVL', '_']; // every gate is spawned with an explicit cwd
export const ENV_NOT_IN_KEY = new RegExp(`^(${[...GIT_HOOK_VARIABLES, ...SHELL_BOOKKEEPING, 'PREFLIGHT_PRE_PUSH'].join('|')}|GIT_PUSH_OPTION_[0-9]+)$`);
// PREFLIGHT_PRE_PUSH says whether the pre-push hook runs the tier or only verifies its stamps
// (lib/preflight-push.mjs); both modes judge the same inputs, so it cannot be part of the key.

/**
 * PATH as the gates see it, without the directory git prepends for its own children.
 * Git puts GIT_EXEC_PATH at the front of PATH for every hook, so a key that kept it could never
 * match between a hook and anything else (the 1 272 s push of REL-1124 re-ran every stamped gate
 * for this). Only an entry equal to GIT_EXEC_PATH is dropped; every other entry stays, in order.
 * @param {string} path @param {string|undefined} execPath @returns {string}
 */
export function pathWithoutGitExecPath(path, execPath) {
  if (!execPath) return path;
  return path.split(':').filter((entry) => entry !== execPath).join(':');
}

/** A gate drives a browser or a built bundle when its import closure says so. */
const BROWSER_MARKER = /from\s+['"](playwright(-core)?|@playwright\/test|@axe-core\/playwright|vite)['"]|import\(\s*['"]playwright|['"]vite['"]\s*,\s*['"]preview['"]/;

/** @param {string} source  @returns {boolean} */
export function drivesABrowser(source) {
  return BROWSER_MARKER.test(source);
}

/** Relative module specifiers a source imports (static and dynamic). @param {string} source @returns {string[]} */
export function localImports(source) {
  const out = [];
  for (const m of source.matchAll(/(?:from\s+|import\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) out.push(m[1]);
  return out;
}

/** @param {string|Buffer} content @returns {string} the git blob id of `content` (SHA-1 object format) */
export function blobId(content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

/** @param {Record<string, string|undefined>} env @returns {[string, string][]} the variables in the key, sorted */
export function envInKey(env) {
  return Object.entries(env)
    .filter(([name, value]) => value !== undefined && !ENV_NOT_IN_KEY.test(name))
    .map(([name, value]) => [name, name === 'PATH' ? pathWithoutGitExecPath(String(value), env.GIT_EXEC_PATH) : String(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The digest of a world: labelled entries, order-independent, a label at most once.
 * @param {[string, string][]} entries  e.g. ['file:citadel-workspaces/src/a.ts', '<blob id>']
 * @returns {string}
 */
export function worldDigest(entries) {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash('sha256').update(`preflight-world/${STAMP_FORMAT}\n`);
  for (let i = 0; i < sorted.length; i++) {
    const [label, value] = sorted[i];
    if (i > 0 && sorted[i - 1][0] === label) throw new Error(`world entry '${label}' appears twice; the key would be ambiguous`);
    if (/[\0\n]/.test(label) || /[\0\n]/.test(value)) throw new Error(`world entry '${label}' holds a NUL or newline; the key would be ambiguous`);
    hash.update(`${label}\0${value}\n`);
  }
  return hash.digest('hex');
}

/**
 * One gate's key over a world.
 * @param {string} world  worldDigest()
 * @param {{ cmd: string, args: string[], cwd: string, env: Record<string, string> }} gate  cwd relative to the parent
 * @returns {string}
 */
export function stampKey(world, { cmd, args, cwd, env }) {
  const identity = JSON.stringify([STAMP_FORMAT, world, cmd, args, cwd, envInKey(env)]);
  return createHash('sha256').update(identity).digest('hex');
}

/**
 * Why stamps are not consulted for this run, or null when they are.
 * @param {string} tier  @param {Record<string, string|undefined>} env  @returns {string|null}
 */
export function stampsOff(tier, env) {
  const flag = env.PREFLIGHT_NO_STAMP;
  if (flag !== undefined && flag !== '1') throw new Error(`PREFLIGHT_NO_STAMP is '${flag}'; set it to 1 or unset it`);
  if (flag === '1') return 'PREFLIGHT_NO_STAMP=1';
  if (tier === 'full') return '--tier full runs every gate';
  return null;
}

/**
 * Which world a check's key is computed over, or null when it is never stamped. Every check is
 * stampable except the checkout checks (`env`: they decide whether anything else means anything)
 * and the `push` checks (they read the REMOTE, which no local key describes). A check run in the
 * agent workspace is keyed over the agent's inputs alone (preflight-world-io.mjs, isAgentInput).
 * @param {{ tiers: Set<string> }} check @param {string} cwd relative to the parent  @returns {'world'|'agent'|null}
 */
export function stampScope(check, cwd) {
  if (check.tiers.has('env') || check.tiers.has('push')) return null;
  return cwd === 'citadel-internal-service' || cwd.startsWith('citadel-internal-service/') ? 'agent' : 'world';
}

/**
 * The first entries two worlds disagree on, for a hook that found no stamp: it names what changed
 * (`env:CARGO_PROFILE_TEST_OPT_LEVEL`, `file:docs/x.md`) instead of only saying "re-run".
 * @param {[string, string][]} before @param {[string, string][]} after @param {number} limit
 * @returns {string[]}
 */
export function worldDifferences(before, after, limit) {
  const was = new Map(before);
  const now = new Map(after);
  const out = [];
  for (const label of [...new Set([...was.keys(), ...now.keys()])].sort()) {
    if (was.get(label) === now.get(label)) continue;
    out.push(`${label}${!was.has(label) ? ' (new)' : !now.has(label) ? ' (gone)' : ''}`);
    if (out.length === limit) break;
  }
  return out;
}

/**
 * What to do with one selected gate. A stamp that could not be read is a reason to run, never a pass.
 * @param {{ stampable: boolean, record: StampRecord|null, unreadable: string|null, now: number }} input
 * @returns {{ run: true, why: string|null, warn?: true } | { run: false, record: StampRecord }}  warn: say why it runs
 */
export function decide({ stampable, record, unreadable, now }) {
  if (!stampable) return { run: true, why: null };
  if (unreadable !== null) return { run: true, why: `its stamp is unreadable (${unreadable})`, warn: true };
  if (record === null) return { run: true, why: 'no stamp for these inputs' };
  if (record.passedAt > now) return { run: true, why: 'its stamp is dated in the future', warn: true };
  if (now - record.passedAt > STAMP_MAX_AGE_MS) return { run: true, why: 'its stamp is older than 12 h' };
  return { run: false, record };
}

/**
 * @typedef {{ format: number, key: string, gate: string, hook: string, passedAt: number, ms: number }} StampRecord
 */

/** @param {string} key @param {string} gate @param {string} hook @param {number} passedAt @param {number} ms @returns {StampRecord} */
export function stampRecord(key, gate, hook, passedAt, ms) {
  return { format: STAMP_FORMAT, key, gate, hook, passedAt, ms };
}

/**
 * Parses a stored stamp. A record that is not exactly what was written throws; decide() then runs the gate.
 * @param {string} text @param {string} key the key it is stored under @param {string} where for the message
 * @returns {StampRecord|null} null for a stamp of an older format (it cannot match)
 */
export function parseStamp(text, key, where) {
  let r;
  try {
    r = JSON.parse(text);
  } catch (error) {
    throw new Error(`stamp ${where} is not JSON (${error.message})`);
  }
  if (r === null || typeof r !== 'object') throw new Error(`stamp ${where} is not a record`);
  if (r.format !== STAMP_FORMAT) return null;
  const ok = r.key === key && typeof r.gate === 'string' && typeof r.hook === 'string'
    && Number.isFinite(r.passedAt) && Number.isFinite(r.ms);
  if (!ok) throw new Error(`stamp ${where} is malformed or filed under the wrong key`);
  return r;
}

/** @param {StampRecord} record @param {number} now @returns {string} the line a stamped gate prints */
export function stampedLine(record, now) {
  const at = new Date(record.passedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const ago = Math.max(0, Math.round((now - record.passedAt) / 60000));
  return `ok (stamped: passed ${when}, ${ago} min ago, in ${record.hook}; ${(record.ms / 1000).toFixed(1)}s not re-run)`;
}
