#!/usr/bin/env node
/**
 * Verify the certificate and key the agent compiles in: the files main.rs's include_bytes! names,
 * read from that line rather than repeated here. lib/certificate-validity.mjs holds the rule.
 *
 *   node scripts/verify-agent-certificate.mjs --floor-days 30   a build that will be published
 *   node scripts/verify-agent-certificate.mjs --floor-days 0    a dry run or a PR's agent leg
 *
 * --floor-days is required. Run from the repository root (the agent-certificate action, and the
 * windows-agent and unix-agents jobs in validate.yml). Node's own X.509 parser, so it runs the
 * same on the Windows runner as on Linux.
 */
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HOST, compiledIn } from './lib/agent-certificate-files.mjs';
import { judgeCertificate, parseFloorDays } from './lib/certificate-validity.mjs';

try {
  const at = process.argv.indexOf('--floor-days');
  const floorDays = parseFloorDays(at < 0 ? undefined : process.argv[at + 1]);
  const certPath = compiledIn('BUILTIN_TLS_CERT');
  const keyPath = compiledIn('BUILTIN_TLS_KEY');
  const cert = new X509Certificate(readFileSync(certPath));
  const notAfterMs = Date.parse(cert.validTo);
  const verdict = judgeCertificate({
    notAfterMs,
    nowMs: Date.now(),
    floorDays,
    coversHost: cert.checkHost(HOST) === HOST,
    keyMatches: cert.checkPrivateKey(createPrivateKey(readFileSync(keyPath))),
    host: HOST,
  });
  if (!verdict.ok) {
    console.error(`::error::${certPath}: ${verdict.reason}`);
    process.exit(1);
  }
  console.log(`  ${certPath}: names ${HOST}, matches ${keyPath}, ${verdict.reason}  ok`);
} catch (error) {
  console.error(`::error::the agent's certificate could not be verified: ${error.message}`);
  process.exit(1);
}
