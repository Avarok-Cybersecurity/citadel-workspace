/**
 * Whether the installed node_modules is the one the lockfile describes (pure).
 *
 * `npm ci` writes node_modules/.package-lock.json, the "hidden lockfile", recording exactly what it
 * installed. A merge that moves package-lock.json without a fresh `npm ci` leaves the two apart, and
 * every gate then runs against packages CI never installs. Compared entry by entry: a package the
 * lockfile pins at another version than the one installed, or a required one never installed.
 * Optional packages (platform builds) are legitimately absent.
 */
export function installDrift(lock, installed) {
  if (installed === null) return { drifted: true, examples: ['node_modules/.package-lock.json is missing'] };
  const have = installed.packages ?? {};
  const examples = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === '') continue;
    const got = have[path];
    if (got === undefined && entry.optional !== true) examples.push(`${path}: not installed`);
    else if (got !== undefined && got.version !== entry.version) examples.push(`${path}: lockfile ${entry.version}, installed ${got.version}`);
  }
  return { drifted: examples.length > 0, examples };
}
