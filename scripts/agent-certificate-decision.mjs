#!/usr/bin/env node
/**
 * Whether this run may ask Let's Encrypt for the agent's certificate, and what to build with
 * instead. The rule, and the week of runs that exhausted the allowance, are in
 * lib/certificate-issuance.mjs; this reads the certificate files and writes the verdict.
 *
 *   node scripts/agent-certificate-decision.mjs release --real-release true|false \
 *     --floor-days N --margin-days N --cached <crt.pem>|none
 *   node scripts/agent-certificate-decision.mjs renew --renew-below-days N --force true|false \
 *     --pending <crt.pem>|none
 *
 * Every flag is required. A path given must exist: "none" is how a caller says there is no cached
 * or pending certificate, so a mistyped path fails instead of reading as "none" and issuing.
 * Writes `action=` (and, for release, `committed-sha256=`) to $GITHUB_OUTPUT when it is set.
 * Exits 1 on refuse. Run from the repository root.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { certificateDaysLeft, compiledIn, fileSha256 } from './lib/agent-certificate-files.mjs';
import { parseBoolean, parseDays, releaseIssuance, renewalIssuance } from './lib/certificate-issuance.mjs';

function flag(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}

function optionalCertificate(name, nowMs) {
  const value = flag(name);
  if (value === 'none') return null;
  if (value === undefined || !existsSync(value)) throw new Error(`--${name} must be an existing certificate file or "none", got ${JSON.stringify(value)}`);
  return certificateDaysLeft(value, nowMs);
}

try {
  const mode = process.argv[2];
  const nowMs = Date.now();
  const committed = compiledIn('BUILTIN_TLS_CERT');
  const committedDaysLeft = certificateDaysLeft(committed, nowMs);
  const outputs = {};
  let verdict;
  if (mode === 'release') {
    verdict = releaseIssuance({
      committedDaysLeft,
      cachedDaysLeft: optionalCertificate('cached', nowMs),
      floorDays: parseDays(flag('floor-days'), '--floor-days'),
      marginDays: parseDays(flag('margin-days'), '--margin-days'),
      realRelease: parseBoolean(flag('real-release'), '--real-release'),
    });
    outputs['committed-sha256'] = fileSha256(committed);
  } else if (mode === 'renew') {
    verdict = renewalIssuance({
      committedDaysLeft,
      pendingDaysLeft: optionalCertificate('pending', nowMs),
      renewBelowDays: parseDays(flag('renew-below-days'), '--renew-below-days'),
      force: parseBoolean(flag('force'), '--force'),
    });
  } else {
    throw new Error(`the first argument must be "release" or "renew", got ${JSON.stringify(mode)}`);
  }
  outputs.action = verdict.action;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
  }
  if (verdict.action === 'refuse') {
    console.error(`::error::${committed}: ${verdict.reason}`);
    process.exit(1);
  }
  console.log(`  ${verdict.action}: ${verdict.reason}`);
} catch (error) {
  console.error(`::error::the certificate decision could not be made: ${error.message}`);
  process.exit(1);
}
