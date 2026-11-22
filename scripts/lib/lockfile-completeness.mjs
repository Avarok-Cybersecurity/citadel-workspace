/**
 * Is every tracked Cargo.lock complete for its manifest? Pure: the cargo runs are made by
 * scripts/check-lockfiles-are-complete.mjs, which hands each result here.
 *
 * "Complete" means `cargo metadata --locked` resolves the workspace without wanting to write the
 * lock -- exactly what every `--locked` build job asks first. A lock goes stale without anyone
 * touching it: tools/telemetry-read and tools/coupon-admin reach the SDK through path deps
 * (citadel-workspace-types -> citadel-internal-service/...), so re-pinning citadel_sdk elsewhere
 * leaves their locks behind, and only those two jobs noticed (Validate PR run 45010060046).
 */

/** The cargo error that means "this lock is stale", in the wording of current and older cargo. */
const STALE = [
  /cannot update the lock file (.+?Cargo\.lock) because --locked was passed/,
  /the lock file (.+?Cargo\.lock) needs to be updated but --locked was passed/,
];

/** Directories holding a tracked Cargo.lock, from `git ls-files -z` output, sorted. */
export function lockDirs(lsFiles) {
  return lsFiles
    .split('\0')
    .filter((p) => p === 'Cargo.lock' || p.endsWith('/Cargo.lock'))
    .map((p) => (p === 'Cargo.lock' ? '.' : p.slice(0, -'/Cargo.lock'.length)))
    .sort();
}

/** The lock file cargo refused to update, or null when stderr is not that refusal. */
export function staleLockIn(stderr) {
  for (const re of STALE) {
    const m = re.exec(stderr);
    if (m) return m[1];
  }
  return null;
}

/** The command that completes a stale lock, moving nothing but what its manifests now require. */
export function fixCommand(dir) {
  return `cargo update --workspace --manifest-path ${dir === '.' ? '' : `${dir}/`}Cargo.toml`;
}

const join = (dir, file) => (dir === '.' ? file : `${dir}/${file}`);

/**
 * One lock's verdict.
 * @param {{ dir: string, status: number|null, stderr: string, workspaceRoot: string|null, absDir: string }} r
 *   workspaceRoot: what cargo metadata reported, absDir: the lock's directory, both absolute
 * @returns {{ ok: true } | { ok: false, kind: 'stale'|'unused'|'error', lock: string, message: string }}
 */
export function verdict({ dir, status, stderr, workspaceRoot, absDir }) {
  const lock = join(dir, 'Cargo.lock');
  if (status === 0) {
    // A lock that is not its workspace root's is never read: cargo uses the outer one, so a
    // complete-looking file here proves nothing and its own build would differ.
    if (workspaceRoot !== absDir) {
      return { ok: false, kind: 'unused', lock, message: `${lock} is not read by cargo: its workspace root is ${workspaceRoot}` };
    }
    return { ok: true };
  }
  if (staleLockIn(stderr) !== null) {
    return { ok: false, kind: 'stale', lock, message: `${lock} is stale for its manifests.\n      fix: ${fixCommand(dir)}  (then commit ${lock})` };
  }
  const last = stderr.trim().split('\n').filter(Boolean).slice(-6).join('\n        ');
  return { ok: false, kind: 'error', lock, message: `cargo metadata could not judge ${lock} (exit ${status}):\n        ${last || '(no output)'}` };
}
