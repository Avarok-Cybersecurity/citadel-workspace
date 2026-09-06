/**
 * Every byte-carrying field in the agent's wire types must redact itself under
 * `{:?}`.
 *
 * `kernel/ext.rs` logs every response with
 * `debug!("Sending kernel response to client: {:?}", ...)`, which is a reasonable
 * thing for it to do — provided the types redact what they carry.
 *
 * `MessageNotification.message` did not. It is the DECRYPTED body of a
 * peer-to-peer message and it was the only `Vec<u8>` in the crate with no debug
 * formatter, so at `RUST_LOG=debug` — the first thing an operator raises when
 * diagnosing delivery — the full plaintext of every message the agent handled went
 * to the log, and from there to whatever collects it and to whatever gets pasted
 * into an issue. The agent exists to keep this material off disk and off the wire.
 *
 * Two formatters are accepted, and which one a field takes is a judgement:
 *
 *   - `bytes_debug_fmt` prints the length and the first and last five bytes. Right
 *     for a key, a ratchet sample, a file chunk: it identifies the value without
 *     disclosing anything usable.
 *   - `plaintext_debug_fmt` prints the length only. Right for a message body,
 *     where five bytes is the opening word and a log holds a great many of them.
 *
 * This gate does not choose between them; it requires that somebody did.
 *
 * Scope is the wire types crate, because that is what gets logged wholesale. The
 * check is textual: the contiguous attribute block directly above the field must
 * carry a `#[debug(with = …)]`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = join(
  ROOT,
  'citadel-internal-service',
  'citadel-internal-service-types',
  'src',
  'lib.rs',
);

if (!existsSync(TYPES)) {
  console.error(
    `FAIL: ${relative(ROOT, TYPES)} does not exist, so this gate examined nothing.\n` +
      'Run `git submodule update --init --recursive` first.',
  );
  process.exit(1);
}

/**
 * A struct field whose type prints its own bytes.
 *
 * `SecBuffer` is deliberately NOT here: it carries its own `Debug`, writing
 * `***SECRET***` and nothing else (citadel_types/src/crypto/mod.rs). Requiring an
 * attribute on top of that would fail two already-safe password fields, and a gate
 * that reports faults it invented is a gate somebody switches off. That the SDK
 * still behaves that way is pinned by a test in the types crate rather than
 * assumed here, so a dependency bump that changed it would be caught.
 */
const BYTE_FIELD = /^\s*(?:pub\s+)?([A-Za-z_]\w*)\s*:\s*(Vec<u8>|HashMap<String,\s*Vec<u8>>)\s*,/;

/** The redaction. Any `with =`, because choosing which one is a judgement. */
const REDACTED = /#\[debug\(with\s*=\s*\w+\)\]/;

const lines = readFileSync(TYPES, 'utf8').split('\n');
const bare = [];
let fieldsSeen = 0;

lines.forEach((line, i) => {
  const m = BYTE_FIELD.exec(line);
  if (!m) return;
  fieldsSeen += 1;

  // Walk back over the field's own contiguous attribute block. `cfg_attr` lines
  // sit between the redaction and the field, so a fixed-size window gets this
  // wrong in both directions — a nearby unrelated attribute reads as coverage,
  // and a real one three lines up reads as missing.
  let redacted = false;
  for (let j = i - 1; j >= 0; j -= 1) {
    const above = lines[j].trim();
    if (above.startsWith('//')) continue; // doc/explanatory lines break nothing
    if (!above.startsWith('#[')) break; // end of this field's attributes
    if (REDACTED.test(above)) { redacted = true; break; }
  }
  if (!redacted) bare.push(`${relative(ROOT, TYPES)}:${i + 1}: \`${m[1]}: ${m[2]}\` prints itself under {:?}`);
});

// Vacuity floor: this crate has a dozen byte fields. Finding none means the type
// spellings changed and the gate is reporting a clean bill over nothing.
if (fieldsSeen < 5) {
  console.error(
    `FAIL: found only ${fieldsSeen} byte-carrying field(s) in ${relative(ROOT, TYPES)}.\n` +
      'The type spellings moved, so this gate examined essentially nothing.',
  );
  process.exit(1);
}

if (bare.length > 0) {
  for (const b of bare) console.error(`::error::${b}`);
  console.error(`\nFAIL: ${bare.length} byte-carrying field(s) have no debug formatter.\n`);
  for (const b of bare) console.error(`  ${b}`);
  console.error(
    '\nAdd `#[debug(with = bytes_debug_fmt)]` for material that identifies a value\n' +
      '(a key, a chunk, a ratchet sample), or `#[debug(with = plaintext_debug_fmt)]`\n' +
      "for the user's own content, where the first five bytes are the opening word.\n" +
      '\nEvery response is logged whole at debug level. A field that prints itself\n' +
      'puts whatever it holds in the log, and the agent exists to keep it out.',
  );
  process.exit(1);
}

console.log(
  `check-byte-fields-do-not-print-themselves: all ${fieldsSeen} byte-carrying field(s) in the ` +
    'wire types redact themselves under {:?}.',
);
