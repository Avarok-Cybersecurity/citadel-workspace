#!/usr/bin/env node
/**
 * The inline-upload byte cap is declared in two languages and nothing bound them.
 *
 * `MAX_BYTE_CONTENTS_BYTES` exists in `server-upload.ts` and in the internal
 * service's `requests/file/upload.rs`. The TypeScript comment says "Keep the
 * two in lockstep" — and that was the whole mechanism. Unlike the permission
 * parity gate and the credential mirror, nothing failed if the Rust cap moved.
 *
 * The symptom of drift is specific and expensive: the browser serialises a file
 * the client believes is acceptable, ships it, and the service rejects it on
 * arrival. A user watches an upload complete and then fail — which is exactly
 * the round trip the TypeScript constant exists to prevent.
 *
 * Both sides are read as TEXT. A guard that imported either constant would pass
 * whatever the other said, which is the failure it is here to catch.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TS_FILE = 'citadel-workspaces/src/lib/file-transfer/server-upload.ts';
const RS_FILE =
  'citadel-internal-service/citadel-internal-service/src/kernel/requests/file/upload.rs';

/** `16 * 1024 * 1024` in either language, evaluated. */
function capFrom(path, pattern) {
  let source;
  try {
    source = readFileSync(join(ROOT, path), 'utf8');
  } catch {
    console.error(`check-transfer-cap-parity: cannot read ${path}; nothing was compared.`);
    process.exit(1);
  }

  const match = source.match(pattern);
  if (!match) {
    console.error(
      `check-transfer-cap-parity: no MAX_BYTE_CONTENTS_BYTES declaration found in ${path}.\n` +
        'It was renamed or reshaped — this comparison cannot be trusted, so it fails\n' +
        'rather than reporting agreement it did not check.',
    );
    process.exit(1);
  }

  return match[1]
    .split('*')
    .map((part) => Number(part.trim()))
    .reduce((a, b) => a * b, 1);
}

// The TypeScript side may carry a type annotation.
//
// `export const MAX_BYTE_CONTENTS_BYTES: number = 16 * 1024 * 1024;` is what the
// explicit-types policy asks for, and this pattern -- written before that policy
// -- matched only the unannotated form. It then failed with "no declaration
// found", which is the right failure: it refused to report agreement it had not
// checked. Widened rather than loosened: the annotation is optional and the
// value is still read from the same place.
const ts = capFrom(TS_FILE, /MAX_BYTE_CONTENTS_BYTES(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*=\s*([\d\s*]+?);/);
const rs = capFrom(RS_FILE, /MAX_BYTE_CONTENTS_BYTES:\s*usize\s*=\s*([\d\s*]+?);/);

if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(rs) || rs <= 0) {
  console.error(
    `check-transfer-cap-parity: parsed a nonsensical cap (ts=${ts}, rs=${rs}).`,
  );
  process.exit(1);
}

if (ts !== rs) {
  console.error('The inline-upload byte cap disagrees across the wire:\n');
  console.error(`  ${TS_FILE}\n    ${ts} bytes`);
  console.error(`  ${RS_FILE}\n    ${rs} bytes\n`);
  console.error(
    ts > rs
      ? 'The browser will serialise and ship files the service then rejects — the user\n' +
          'watches an upload finish and fail.'
      : 'The browser refuses files the service would have accepted, for no reason the\n' +
          'user can see.',
  );
  process.exit(1);
}

console.log(`The inline-upload cap agrees across both languages (${ts} bytes).`);
