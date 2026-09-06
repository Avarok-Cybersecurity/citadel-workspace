/**
 * A disconnect that did not happen must not be reported as one.
 *
 * The connection map entry is removed BEFORE the SDK disconnect, so RAII cleanup cannot fire
 * mid-call. When that disconnect then fails or times out, the SDK may still hold the session —
 * and both failure branches used to log "Proceeding anyway" and return a
 * DisconnectNotification, i.e. success. The result is a session the SDK has and the map does
 * not: the next Connect for that username finds no entry, goes straight to `remote.connect()`,
 * and is refused because the SDK still has one. The account is unreachable until the agent
 * restarts, and the person was told they had signed out.
 *
 * This reads each failure arm's OWN body — brace-matched, not a fixed window, because a window
 * wide enough to reach the next arm made an earlier version of this gate unable to fail.
 */
import { readFileSync } from 'node:fs';

const FILE =
  'citadel-internal-service/citadel-internal-service/src/kernel/requests/peer/disconnect.rs';
const source = readFileSync(FILE, 'utf8');
const problems = [];

/** The body of the match arm introduced by `marker`, from its `{` to the matching `}`. */
function armBody(text, marker) {
  const at = text.indexOf(marker);
  if (at === -1) return null;
  const open = text.indexOf('{', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

for (const arm of ['Ok(Err(', 'Err(_elapsed)']) {
  const body = armBody(source, arm);
  if (body === null) {
    problems.push(`the \`${arm}\` arm has gone — this gate is reading a shape that no longer exists`);
    continue;
  }
  if (!/restore_and_report/.test(body)) {
    problems.push(`the \`${arm}\` arm no longer restores state and reports failure`);
  }
}

// The wording that marked the defect, in CODE only: the doc comment on
// `restore_and_report` quotes it deliberately, to explain what it replaced.
const code = source
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');
if (/Proceeding anyway/.test(code)) {
  problems.push('a failure branch still says "Proceeding anyway" — that wording marked the defect');
}

if (problems.length) {
  problems.forEach((p) => console.error(`::error file=${FILE}::${p}`));
  console.error('FAIL: a disconnect that did not happen must not be reported as one.');
  process.exit(1);
}
console.log('OK: both SDK-disconnect failure branches restore state and report failure.');
