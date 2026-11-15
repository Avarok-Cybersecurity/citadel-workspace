/**
 * Signs the first-party apps every workspace is provisioned with (Calendar design §3.2), for
 * `node scripts/build-first-party-apps.mjs --sign <out>`: each app's committed manifest and module
 * through apps/first-party/signer, into <out>/<app>/{manifest.json,app.mldsa.sig}, the directory
 * the kernel's build.rs embeds (CITADEL_FIRST_PARTY_SIGNED_DIR).
 *
 * The seed is CITADEL_APP_SIGNING_SEED_HEX, handed to the signer in its environment and nowhere
 * else: this never prints it, writes it or passes it as an argument, and the signer prints only the
 * key's fingerprint. Unset, nothing is signed (PCND): there is no default key.
 *
 * Every key signed with is held against FIRST_PARTY_PUBLISHER_KEYS in the kernel's install.rs, the
 * one list of first-party keys: the deploy's must be in it (a release the kernel would refuse at
 * provisioning fails here, before anything ships), and with `throwaway` (PR CI, which has no
 * secret and proves the path with a seed it makes) it must not be.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEED_ENV = 'CITADEL_APP_SIGNING_SEED_HEX';

/** The apps provisioned into every workspace, and where each one's module is committed. */
export const PROVISIONED_APPS = [
  { app: 'calendar', module: 'citadel-workspaces/public/calendar/calendar_glue_bg.wasm' },
];

/** The first-party keys, read from install.rs. */
export function firstPartyKeys(installRs) {
  const list = /pub const FIRST_PARTY_PUBLISHER_KEYS: &\[&str\] = &\[([^\]]*)\];/.exec(installRs);
  if (list === null) throw new Error('install.rs no longer declares FIRST_PARTY_PUBLISHER_KEYS as a string list');
  return [...list[1].matchAll(/"([0-9a-f]+)"/g)].map((m) => m[1]);
}

/** Why the key an app was signed with is wrong for this run, or null. */
export function keyProblem(app, key, trusted, throwaway) {
  const first = trusted.includes(key);
  if (throwaway && first) return `${app}: a throwaway seed signed with a first-party key`;
  if (!throwaway && !first) return `${app}: the seed's key is not in FIRST_PARTY_PUBLISHER_KEYS, so provisioning would refuse it`;
  return null;
}

/** The compiler the first-party apps pin, which the signer is built with too. */
function toolchainPin(root) {
  const toml = readFileSync(join(root, 'apps/first-party/compute-pool/rust-toolchain.toml'), 'utf8');
  const pin = /^channel = "([^"]+)"$/m.exec(toml)?.[1];
  if (!pin) throw new Error('apps/first-party/compute-pool/rust-toolchain.toml names no channel');
  return pin;
}

/** Signs every provisioned app into `out`; returns the problems, empty when all is well. */
export function signFirstPartyApps(root, out, { throwaway }) {
  if (!process.env[SEED_ENV]) return [`${SEED_ENV} is not set: nothing to sign with`];
  const trusted = firstPartyKeys(readFileSync(join(root, 'citadel-workspace-server-kernel/src/kernel/apps/install.rs'), 'utf8'));
  const pin = toolchainPin(root);
  const problems = [];
  for (const { app, module } of PROVISIONED_APPS) {
    const signed = join(out, app);
    const args = [`+${pin}`, 'run', '--quiet', '--locked', '--release', '--manifest-path', join(root, 'apps/first-party/signer/Cargo.toml'),
      '--', join(root, 'apps/first-party', app), signed, join(root, module)];
    const r = spawnSync('cargo', args, { stdio: 'inherit', env: process.env });
    if (r.status !== 0) {
      problems.push(`${app}: the signer exited ${r.status ?? r.signal}`);
      continue;
    }
    const key = JSON.parse(readFileSync(join(signed, 'manifest.json'), 'utf8')).publisher.mldsa65_public_key;
    const problem = keyProblem(app, key, trusted, throwaway);
    if (problem !== null) problems.push(problem);
  }
  return problems;
}
