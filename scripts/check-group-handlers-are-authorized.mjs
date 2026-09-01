#!/usr/bin/env node
// Every group-chat request handler must ask a group authorization gate first.
//
// A group's messages are scoped to the node that owns its channel, and the only
// thing standing between a request and that history is a call to
// `authorize_group_read` or `authorize_group_write`. Both already exist and all
// five current handlers use the right one — but nothing says the sixth will.
//
// This has been wrong here before: every group-messaging handler once asked the
// READ question, including the three that write, so a Guest — whose role
// definition is "read-only access" — could post into, edit and delete chat in
// every room it could see. That was fixed by hand, in five places, and the fix
// is currently held in place by nothing.
//
// Read and write are deliberately not distinguished here. Which gate a handler
// needs is a judgement about the operation; that it asks one at all is not.
import { readFileSync } from 'node:fs';

const SOURCE = 'citadel-workspace-server-kernel/src/kernel/command_processor/async_process_command.rs';
// Requests whose subject is a group chat channel.
const GROUP_REQUEST = /WorkspaceProtocolRequest::((?:Send|Edit|Delete|Get)(?:Group|Thread)[A-Za-z]*)\s*\{/;
// The CALL, not the import. Matching the bare name also matched
// `use crate::kernel::group_access::{authorize_group_write, ...}` on the line
// above it, so a handler that imported the gate and never called it passed —
// which a control caught by removing the call and watching this stay green.
const GATE = /\bauthorize_group_(?:read|write)\s*\(/;
// How far into an arm the gate may sit. The gates run first in every current
// handler; this is slack, not licence.
//
// The window is also cut at the NEXT arm, which it was not. A 40-line slice from
// one arm spilled into the following one, so deleting a handler's gate could
// leave it green on its neighbour's — a control confirmed exactly that for
// GetGroupMessages, whose gate deletion shifted GetThreadMessages' own call from
// line 930 to 921, i.e. into the window. The gate was reading "some group
// handler nearby asks", which is not the property.
const WINDOW = 40;
// Any arm head, not just a group one: the boundary is where THIS arm ends.
const ANY_ARM = /WorkspaceProtocolRequest::[A-Za-z]+\s*[{(]/;

let lines;
try {
  lines = readFileSync(SOURCE, 'utf8').split('\n');
} catch {
  console.error(`FAIL: cannot read ${SOURCE}.`);
  console.error('A check that cannot find its subject must not report success.');
  process.exit(1);
}

const problems = [];
let checked = 0;
lines.forEach((line, i) => {
  const code = line.replace(/\/\/.*$/, '');
  const m = code.match(GROUP_REQUEST);
  if (!m) return;
  checked++;
  const slice = lines.slice(i + 1, i + WINDOW);
  const nextArm = slice.findIndex((l) => ANY_ARM.test(l.replace(/\/\/.*$/, '')));
  const arm = slice
    .slice(0, nextArm === -1 ? slice.length : nextArm)
    .filter((l) => !/^\s*use\s/.test(l))
    .join('\n');
  if (!GATE.test(arm)) problems.push({ request: m[1], line: i + 1 });
});

if (!checked) {
  console.error('FAIL: found no group-chat request handlers at all — the pattern has gone stale.');
  console.error('A gate that matches nothing reports a safety it never measured.');
  process.exit(1);
}

for (const p of problems) {
  console.error(`::error file=${SOURCE},line=${p.line}::${p.request} is handled without a group authorization gate`);
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} of ${checked} group handler(s) ask no authorization gate.`);
  console.error('Call authorize_group_read for a read, authorize_group_write for a write.');
  console.error('Write handlers asking the READ gate is how a Guest once got to post, edit and delete.');
  process.exit(1);
}
console.log(`OK: all ${checked} group-chat handler(s) ask an authorization gate.`);
