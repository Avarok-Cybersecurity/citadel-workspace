#!/usr/bin/env node
// A third-party image in a compose file must name a version, not float.
//
// `latest` is safe for our OWN three images and this is reasoned out at length
// in docker-compose.production.yml: CI advances that tag only through a
// `promote-latest` job requiring every image in the release to have built and
// passed its smoke test, and `verify-image-revisions.sh` additionally proves
// the pulled set came from one commit. Neither protection is available for a
// tag someone else controls.
//
// `cloudflare/cloudflared:latest` was floating in the production stack. With
// `restart: unless-stopped`, a host reboot after a registry pull would swap the
// process that terminates the public tunnel, with nobody choosing to and no
// record of which version had been running. It also silently contradicted the
// same file's instruction to "pin an explicit SHA tag for a deploy you need to
// be able to reproduce exactly" — unachievable while any service floats.
//
// SCOPE, stated so this is not read as more than it is: this checks the tag is
// not floating. It does NOT pin by digest, so a publisher who force-pushes a
// version tag still moves the image underneath us. Digest pinning would be
// strictly stronger and is deliberately not required here, because compose
// files are edited by operators and a digest is unreadable to review.
import { readFileSync, readdirSync } from 'node:fs';

// Ours are exempt: CI gates their `latest`. Anything else is someone else's.
const OURS = /^ghcr\.io\/avarok-cybersecurity\//;

const files = readdirSync('.').filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
if (files.length === 0) {
  console.error('FAIL: no docker-compose files found, so nothing was checked.');
  process.exit(1);
}

const offenders = [];
let thirdPartyImagesSeen = 0;

for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const m = line.match(/^\s*image:\s*(\S+)\s*$/);
    if (!m) return;
    const ref = m[1];
    if (OURS.test(ref)) return;
    // `${VAR:-default}` pins via the default; judge the default it resolves to.
    const resolved = ref.replace(/\$\{[^:}]+:-([^}]*)\}/g, '$1').replace(/\$\{[^}]+\}/g, '');
    thirdPartyImagesSeen += 1;
    const tag = resolved.split(':')[1];
    if (!tag || tag === 'latest') {
      offenders.push({ file, line: i + 1, ref, why: tag ? 'floats on `latest`' : 'names no tag' });
    }
  });
}

// A gate that scanned nothing reports the same green as a gate that passed.
if (thirdPartyImagesSeen === 0) {
  console.error('FAIL: no third-party images found in any compose file.');
  console.error('Either they were all removed, or the `image:` pattern stopped matching.');
  console.error('Both mean this gate is measuring nothing; it must not report success.');
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) {
    console.error(`::error file=${o.file},line=${o.line}::${o.ref} ${o.why}`);
  }
  console.error(`\nFAIL: ${offenders.length} third-party image(s) are not pinned.`);
  console.error('Pin to a released version, e.g. `cloudflare/cloudflared:${CLOUDFLARED_TAG:-2026.8.3}`.');
  console.error('Our own ghcr.io/avarok-cybersecurity images are exempt: CI gates their `latest`.');
  process.exit(1);
}

console.log(`check-third-party-images-are-pinned: ${thirdPartyImagesSeen} third-party image(s), all pinned.`);
