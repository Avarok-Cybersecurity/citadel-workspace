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

/**
 * Ways this handler can say "the disconnect happened".
 *
 * Deliberately a small list of SHAPES rather than one identifier: the point is
 * that a failure arm must not reach any of them, however the success path is
 * spelled this month.
 */
const SUCCESS_SHAPES = [/SdkDisconnect::Succeeded/, /DisconnectNotification/, /PeerDisconnectSuccess/];

/** Ways it can say the disconnect did NOT happen. */
const FAILURE_SHAPES = [
  /SdkDisconnect::(Failed|TimedOut)/,
  /PeerDisconnectFailure/,
  /restore_and_report/, // the earlier spelling, still acceptable
];

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
  // Assert the PROPERTY, not an identifier.
  //
  // This used to require the literal `restore_and_report`, the helper the fix
  // introduced at the time. That helper has since been replaced by an
  // `SdkDisconnect` enum whose variants make the same distinction better --
  // and the gate would have gone red on the improved, tested code the moment
  // the submodule pointer moved. Somebody would then have rewritten a correct
  // fix to satisfy a regex, or spent an hour learning the named function was
  // gone.
  //
  // A gate that names the CURRENT implementation forbids the next one. What
  // must hold is narrower and permanent: a failure arm must not evaluate to
  // the success outcome. Everything else is free to change.
  const claimsSuccess = SUCCESS_SHAPES.some((shape) => shape.test(body));
  if (claimsSuccess) {
    problems.push(
      `the \`${arm}\` arm reports SUCCESS — a disconnect that failed must not be reported as one`,
    );
    continue;
  }
  if (!FAILURE_SHAPES.some((shape) => shape.test(body))) {
    problems.push(
      `the \`${arm}\` arm reports neither success nor failure; it must say the disconnect did ` +
        `not happen (found: ${body.replace(/\s+/g, ' ').slice(0, 120)}…)`,
    );
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
console.log('OK: neither SDK-disconnect failure branch reports success.');
