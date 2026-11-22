/**
 * The macOS version the agent is built for, read from the one place that states it: the app
 * bundle's LSMinimumSystemVersion (apps/macos-agent/Info.plist), the version macOS refuses to
 * launch the app below.
 *
 * Without it set, rustc and the C compilers each pick their own: rustc its target default (11.0
 * on arm64, 10.12 on Intel) and clang whatever MACOSX_DEPLOYMENT_TARGET the builder's shell
 * exports. A shell exporting `16.0`, a version macOS never had (15 was followed by 26), makes
 * clang warn "overriding deployment version from '16.0.0' to '26.0'" on every compile; aws-lc-sys
 * probes its flags under -Werror, so every probe failed, it dropped its `-ffile-prefix-map`, and
 * the agent shipped 77 build-machine paths. One explicit value for both compilers ends that.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './remap-paths.mjs';

export const INFO_PLIST = join(ROOT, 'apps', 'macos-agent', 'Info.plist');

/** LSMinimumSystemVersion's value in an Info.plist's text, as `major.minor`. */
export function minimumSystemVersion(plist) {
  const value = /<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];
  if (value === undefined) throw new Error('macos-deployment-target: the Info.plist has no LSMinimumSystemVersion');
  if (!/^\d+\.\d+$/.test(value)) throw new Error(`macos-deployment-target: '${value}' is not a major.minor macOS version`);
  return value;
}

/** The variable rustc, the `cc` crate and clang all read, for an Apple macOS target only. */
export function deploymentTargetEnv(triple, plist) {
  if (!triple.endsWith('-apple-darwin')) throw new Error(`macos-deployment-target: '${triple}' is not a macOS target`);
  return { name: 'MACOSX_DEPLOYMENT_TARGET', value: minimumSystemVersion(plist) };
}

export function readInfoPlist() {
  return readFileSync(INFO_PLIST, 'utf8');
}
