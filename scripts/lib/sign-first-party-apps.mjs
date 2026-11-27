/**
 * Signs the first-party apps every workspace is provisioned with (Calendar design §3.2), for
 * `node scripts/build-first-party-apps.mjs --sign <out>`: each app's committed manifest and module
 * through apps/first-party/signer, into <out>/<app>/{manifest.json,app.mldsa.sig}, the directory
 * the kernel's build.rs embeds (CITADEL_FIRST_PARTY_SIGNED_DIR). The signer also writes
 * <out>/<app>/module.wasm for an app whose module the server stores (any ABI but the glue one),
 * which this holds it to: provisioning lists such an app only with its module.
 *
 * The seed is CITADEL_APP_SIGNING_SEED_HEX, handed to the signer in its environment and nowhere
 * else: this never prints it, writes it or passes it as an argument, and the signer prints only the
 * key's fingerprint. Unset, nothing is signed (PCND): there is no default key.
 *
 * Every key signed with is held against the kernel's two lists: FIRST_PARTY_PUBLISHER_KEYS
 * (install.rs, production) and CI_FIRST_PARTY_PUBLISHER_KEYS (ci_first_party_root.rs, trusted only
 * by the integration image's kernel). One mode per run:
 *   deploy     the seed in CITADEL_APP_SIGNING_SEED_HEX; its key must be in the production list and
 *              not the CI one (a release the kernel would refuse at provisioning fails here, before
 *              anything ships), and the seed must not be the published CI seed;
 *   throwaway  the same variable, a seed PR CI makes to prove the path: its key in neither list;
 *   ci         the published CI seed committed beside ci_first_party_root.rs, for the integration
 *              stack; the variable must be unset, and the key must be the CI root's and no
 *              production key.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEED_ENV = 'CITADEL_APP_SIGNING_SEED_HEX';

/** The apps provisioned into every workspace, and where each one's module is committed. */
export const PROVISIONED_APPS = [
  { app: 'calendar', module: 'citadel-workspaces/public/calendar/calendar_glue_bg.wasm' },
  { app: 'synchronized-work', module: 'apps/first-party/synchronized-work/wasm/synchronized-work.wasm' },
];

/** The ABI whose module is in the UI bundle, not the server's (`ABI_FIRST_PARTY_GLUE`). */
export const GLUE_ABI = 'wasm-bindgen-glue-firstparty';
/** What the signer writes beside the signature for any other ABI, and build.rs embeds. */
export const MODULE_FILE = 'module.wasm';

/** Why a signed app's module copy is wrong, or null: present exactly when its ABI is not glue. */
export function moduleProblem(app, abi, hasModule) {
  if (abi !== GLUE_ABI && !hasModule) return `${app}: the signer wrote no ${MODULE_FILE} for an ${abi} app`;
  if (abi === GLUE_ABI && hasModule) return `${app}: a glue app's module is in the UI bundle, not ${MODULE_FILE}`;
  return null;
}

export const MODES = ['deploy', 'throwaway', 'ci'];
const KERNEL_APPS = 'citadel-workspace-server-kernel/src/kernel/apps';
const INSTALL_RS = `${KERNEL_APPS}/install.rs`;
const CI_ROOT_RS = `${KERNEL_APPS}/ci_first_party_root.rs`;
const CI_SEED = `${KERNEL_APPS}/ci_first_party_root.seed`;

/** The keys `source` lists under `name` (a `pub const NAME: &[&str] = &[...]`). */
export function listedKeys(source, name) {
  const list = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\];`).exec(source);
  if (list === null) throw new Error(`no longer declares ${name} as a string list`);
  return [...list[1].matchAll(/"([0-9a-f]+)"/g)].map((m) => m[1]);
}

/** The first-party keys, read from install.rs. */
export const firstPartyKeys = (installRs) => listedKeys(installRs, 'FIRST_PARTY_PUBLISHER_KEYS');
/** The CI root's keys, read from ci_first_party_root.rs. */
export const ciRootKeys = (ciRootRs) => listedKeys(ciRootRs, 'CI_FIRST_PARTY_PUBLISHER_KEYS');

/** Both lists, read from the kernel in `root`. */
export function kernelKeyLists(root) {
  return {
    production: firstPartyKeys(readFileSync(join(root, INSTALL_RS), 'utf8')),
    ci: ciRootKeys(readFileSync(join(root, CI_ROOT_RS), 'utf8')),
  };
}

/** The published CI seed, hex: the committed 32 bytes of text. */
export function ciSeedHex(root) {
  const seed = readFileSync(join(root, CI_SEED));
  if (seed.length !== 32) throw new Error(`${CI_SEED} holds ${seed.length} bytes, not a 32-byte seed`);
  return seed.toString('hex');
}

/** Why the key an app was signed with is wrong for a `mode` run, or null. */
export function keyProblem(app, key, { production, ci }, mode) {
  const first = production.includes(key);
  const ciRoot = ci.includes(key);
  if (mode === 'deploy' && ciRoot) return `${app}: a deploy signed with the CI root's published key`;
  if (mode === 'deploy' && !first) return `${app}: the seed's key is not in FIRST_PARTY_PUBLISHER_KEYS, so provisioning would refuse it`;
  if (mode === 'throwaway' && (first || ciRoot)) return `${app}: a throwaway seed signed with a ${first ? 'first-party' : 'CI root'} key`;
  if (mode === 'ci' && first) return `${app}: a CI run signed with a first-party key`;
  if (mode === 'ci' && !ciRoot) return `${app}: the key is not the CI root's (CI_FIRST_PARTY_PUBLISHER_KEYS)`;
  return null;
}

/** The seed a `mode` run signs with, or why it may not run. */
export function seedFor(mode, envSeed, ciSeed) {
  if (!MODES.includes(mode)) return { problem: `unknown signing mode '${mode}'` };
  if (mode === 'ci') {
    if (envSeed) return { problem: `${SEED_ENV} is set: a CI run signs only with the published CI seed` };
    return { seed: ciSeed };
  }
  if (!envSeed) return { problem: `${SEED_ENV} is not set: nothing to sign with` };
  if (mode === 'deploy' && envSeed.trim().toLowerCase() === ciSeed) return { problem: `${SEED_ENV} is the published CI seed: a deploy never signs with it` };
  return { seed: envSeed };
}

/** The compiler the first-party apps pin, which the signer is built with too. */
function toolchainPin(root) {
  const toml = readFileSync(join(root, 'apps/first-party/compute-pool/rust-toolchain.toml'), 'utf8');
  const pin = /^channel = "([^"]+)"$/m.exec(toml)?.[1];
  if (!pin) throw new Error('apps/first-party/compute-pool/rust-toolchain.toml names no channel');
  return pin;
}

/** Signs every provisioned app into `out` in `mode`; returns the problems, empty when all is well. */
export function signFirstPartyApps(root, out, mode) {
  const { seed, problem } = seedFor(mode, process.env[SEED_ENV], ciSeedHex(root));
  if (problem !== undefined) return [problem];
  const lists = kernelKeyLists(root);
  const pin = toolchainPin(root);
  const problems = [];
  for (const { app, module } of PROVISIONED_APPS) {
    const signed = join(out, app);
    const args = [`+${pin}`, 'run', '--quiet', '--locked', '--release', '--manifest-path', join(root, 'apps/first-party/signer/Cargo.toml'),
      '--', join(root, 'apps/first-party', app), signed, join(root, module)];
    const r = spawnSync('cargo', args, { stdio: 'inherit', env: { ...process.env, [SEED_ENV]: seed } });
    if (r.status !== 0) {
      problems.push(`${app}: the signer exited ${r.status ?? r.signal}`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(signed, 'manifest.json'), 'utf8'));
    for (const problem of [
      keyProblem(app, manifest.publisher.mldsa65_public_key, lists, mode),
      moduleProblem(app, manifest.sdk.abi, existsSync(join(signed, MODULE_FILE))),
    ]) {
      if (problem !== null) problems.push(problem);
    }
  }
  return problems;
}
