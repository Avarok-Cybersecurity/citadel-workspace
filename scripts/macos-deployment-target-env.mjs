#!/usr/bin/env node
/**
 * Prints `MACOSX_DEPLOYMENT_TARGET=<version>` for a macOS target: the app bundle's minimum
 * (scripts/lib/macos-deployment-target.mjs), so rustc and every C compiler build for the same one.
 *
 *   node scripts/macos-deployment-target-env.mjs <*-apple-darwin triple>
 *
 * In bash, assign before exporting, so a failure here stops a `set -e` script.
 */
import { deploymentTargetEnv, readInfoPlist } from './lib/macos-deployment-target.mjs';

const [triple, ...rest] = process.argv.slice(2);
if (!triple || rest.length) {
  console.error('usage: macos-deployment-target-env.mjs <*-apple-darwin triple>');
  process.exit(1);
}
try {
  const { name, value } = deploymentTargetEnv(triple, readInfoPlist());
  process.stdout.write(`${name}=${value}\n`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
