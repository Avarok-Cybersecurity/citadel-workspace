/**
 * The certificate files the agent compiles in, found from main.rs's include_bytes! lines rather
 * than repeated, and the facts CI reads from a certificate file. The I/O half of
 * verify-agent-certificate.mjs and agent-certificate-decision.mjs; the rules are pure, in
 * certificate-validity.mjs and certificate-issuance.mjs.
 */
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { daysLeft } from './certificate-validity.mjs';

export const MAIN = 'citadel-workspace-internal-service/src/main.rs';
/** The name a hosted page dials the user's own agent at. */
export const HOST = 'local.avarok.net';

/** The repository-relative path a `const <constant>: &[u8] = include_bytes!("...")` names. */
export function compiledIn(constant) {
  const source = readFileSync(MAIN, 'utf8');
  const m = new RegExp(`const ${constant}: &\\[u8\\] = include_bytes!\\("([^"]+)"\\);`).exec(source);
  if (!m) throw new Error(`${MAIN} no longer has \`const ${constant}: &[u8] = include_bytes!("...")\``);
  return relative('.', join(dirname(MAIN), m[1]));
}

/** Whole days the PEM certificate at `path` has left at `nowMs`. */
export function certificateDaysLeft(path, nowMs) {
  return daysLeft(Date.parse(new X509Certificate(readFileSync(path)).validTo), nowMs);
}

/** The file's sha256, hex: names the committed certificate a cached one was issued in place of. */
export function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
