/**
 * A test behind a cargo feature CI does not enable is not skipped. It does not
 * exist.
 *
 * `citadel-internal-service-connector` puts `origin_policy` and `websockets`
 * behind `#[cfg(feature = "websockets")]`, which is a default feature nowhere.
 * Those two modules hold every test of the agent's loopback boundary — which
 * browser origins may open a control connection to it — and `cargo nextest run`
 * with no flags compiled **11** tests where the feature compiles **27**.
 *
 * The 16 missing ones included `a_listed_origin_completes_the_handshake` and
 * `an_unlisted_origin_is_refused_at_the_handshake`. Replacing the origin check's
 * body with `Ok(response)` — accept every origin, from any web page the user
 * happens to visit — turned nothing red, because the tests that would object
 * were not in the binary. Production ships the feature, so CI was green over a
 * configuration nobody runs while the one everybody runs went untested.
 *
 * This is the second time. `docs/ROBUSTNESS.md` round 564 records the same
 * defect and the same fix, "6 passed" becoming "33 passed". The flag was lost
 * again in the interim, silently, because a test count going DOWN looks exactly
 * like a green run.
 *
 * THE RULE. If a `#[cfg(feature = "X")]` guards a module that contains tests,
 * some CI command that runs tests must pass `--features` naming X.
 *
 * ENABLED THREE WAYS, and all three must be consulted. Its first version knew
 * only about `--features` flags and immediately reported two ILM modules as
 * uncompiled — while `cargo nextest list` shows their six tests running,
 * because `citadel-internal-service-connector` depends on ILM with
 * `features = ["testing"]` and that turns the feature on for the whole build.
 * Two invented findings out of two new ones is the ratio that gets a gate
 * switched off, so it now resolves:
 *
 *   1. a `--features` flag on a CI test command;
 *   2. a workspace crate depending on the owner with the feature listed;
 *   3. the owning crate's own `default` feature set.
 *
 * WHAT IT STILL CANNOT SEE: a feature turned on by a THIRD-PARTY dependency's
 * default features, since it reads this tree's manifests only. That is a
 * narrower blind spot than the one it was written for — the flag is what a
 * person deletes, and deleting it is what happened twice.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = join(ROOT, 'citadel-internal-service');

if (!existsSync(AGENT)) {
  console.error(
    'FAIL: the agent submodule is not present, so this gate examined nothing.\n' +
      'Run `git submodule update --init --recursive` first.',
  );
  process.exit(1);
}

/** Every workflow that might run tests, in both repos. */
const WORKFLOW_DIRS = [join(ROOT, '.github', 'workflows'), join(AGENT, '.github', 'workflows')];

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'target' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    // `statSync` FOLLOWS symlinks, and this tree contains a dangling one
    // (`typescript-client/typescript-client`) that made the walk throw ENOENT
    // and take the whole gate down. A gate that crashes reports nothing, which
    // is worse than a gate that reports a miss.
    let entryStat;
    try {
      entryStat = statSync(full);
    } catch {
      continue;
    }
    if (entryStat.isDirectory()) { yield* rustFiles(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

/** `#[cfg(feature = "x")]` on the line before a `mod y;`. */
const GATED_MOD = /#\[cfg\(feature\s*=\s*"([^"]+)"\)\]\s*\n\s*(?:pub\s+)?mod\s+(\w+)\s*;/g;

/** A module body that contains tests. */
const HAS_TESTS = /#\[(?:tokio::)?test\]|#\[cfg\(test\)\]/;

/** Features named by any `--features` flag in a workflow that runs tests. */
function ciFeatures() {
  const enabled = new Set();
  let commandsSeen = 0;
  for (const dir of WORKFLOW_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/\.ya?ml$/.test(f)) continue;
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (/^\s*#/.test(line)) continue; // a comment enables nothing
        if (!/cargo\s+(nextest\s+run|test)\b/.test(line)) continue;
        commandsSeen += 1;
        const m = line.match(/--features[=\s]+([A-Za-z0-9_,\-]+)/);
        if (m) for (const name of m[1].split(',')) enabled.add(name.trim());
      }
    }
  }
  return { enabled, commandsSeen };
}

/**
 * Features some manifest in the tree turns on, either by depending on a crate
 * with `features = [...]` or by listing them in that crate's own `default`.
 *
 * Keyed `crate/feature`, because `testing` on one crate says nothing about
 * `testing` on another.
 */
function manifestFeatures(dir, found = new Set()) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'target' || entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { manifestFeatures(full, found); continue; }
    if (entry !== 'Cargo.toml') continue;

    const toml = readFileSync(full, 'utf8');

    // `some-crate = { …, features = ["a", "b"] }`
    for (const m of toml.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*features\s*=\s*\[([^\]]*)\]/gm)) {
      for (const f of m[2].split(',')) {
        const name = f.trim().replace(/^["']|["']$/g, '');
        if (name) found.add(`${m[1]}/${name}`);
      }
    }

    // This crate's own `default = [...]`, which enables its features for itself.
    const self = toml.match(/^\s*name\s*=\s*"([^"]+)"/m);
    const dflt = toml.match(/^\s*default\s*=\s*\[([^\]]*)\]/m);
    if (self && dflt) {
      for (const f of dflt[1].split(',')) {
        const name = f.trim().replace(/^["']|["']$/g, '');
        if (name) found.add(`${self[1]}/${name}`);
      }
    }
  }
  return found;
}

/** The crate a source file belongs to: nearest Cargo.toml walking up. */
function owningCrate(file) {
  let dir = dirname(file);
  while (dir.startsWith(ROOT)) {
    const manifest = join(dir, 'Cargo.toml');
    if (existsSync(manifest)) {
      const m = readFileSync(manifest, 'utf8').match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const { enabled, commandsSeen } = ciFeatures();
const viaManifest = manifestFeatures(AGENT);

const problems = [];
let gatedModsSeen = 0;
let filesRead = 0;

for (const file of rustFiles(join(AGENT))) {
  filesRead += 1;
  const source = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  GATED_MOD.lastIndex = 0;
  let m;
  while ((m = GATED_MOD.exec(source)) !== null) {
    const [, feature, modName] = m;
    // Where does that module's code live?
    const dir = dirname(file);
    const candidates = [join(dir, `${modName}.rs`), join(dir, modName, 'mod.rs')];
    const body = candidates.find((c) => existsSync(c));
    if (!body) continue;
    if (!HAS_TESTS.test(readFileSync(body, 'utf8'))) continue;

    gatedModsSeen += 1;
    if (enabled.has(feature)) continue;
    const owner = owningCrate(file);
    if (owner && viaManifest.has(`${owner}/${feature}`)) continue;
    problems.push(
      `${rel}: \`mod ${modName}\` is behind \`#[cfg(feature = "${feature}")]\` and contains ` +
        `tests, but no CI test command passes \`--features ${feature}\` — those tests are ` +
        'not compiled anywhere',
    );
  }
}

// Vacuity floors. Both populations exist; a zero on either means the gate read
// nothing and reported safety over it, which is the defect it is about.
if (filesRead < 20 || commandsSeen === 0 || gatedModsSeen === 0) {
  console.error(
    `FAIL: ${filesRead} rust file(s), ${commandsSeen} CI test command(s), ` +
      `${gatedModsSeen} feature-gated module(s) with tests.\n` +
      'A zero on any of those means this gate examined nothing.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} feature-gated test module(s) that CI never compiles.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nAdd the feature to the test command, e.g. `cargo nextest run --features websockets`,\n' +
      'or depend on the crate with that feature from something CI builds.\n' +
      '\nA test behind a feature CI does not enable is not skipped — it is absent, and the run\n' +
      'is green. The last time this happened, every test of which browser origins may open a\n' +
      'control connection to the agent was missing, and the suite said 11 passed.',
  );
  process.exit(1);
}

console.log(
  `check-feature-gated-tests-are-compiled: ${gatedModsSeen} feature-gated test module(s) across ` +
    `${filesRead} file(s); every gating feature is enabled by some CI test command ` +
    `(${commandsSeen} examined).`,
);
