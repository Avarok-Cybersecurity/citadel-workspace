#!/usr/bin/env node
/**
 * A message's sender must come from the transport, never from its payload.
 *
 * Every inbound P2P handler receives `peerCid` — the authenticated channel
 * identity — as a parameter. `payload.sender_cid` is a field the SENDING peer
 * chooses. Setting `senderCid` from it lets any registered peer attribute a
 * message to anyone: set it to the recipient's own CID and converters.ts
 * renders the message right-aligned, styled as own, and labelled "You" — a
 * forged message from yourself, in your own transcript.
 *
 * This has now been found twice, in two handlers of the SAME wire envelope
 * dispatched from the same place: message-handler-routing was fixed and
 * file-transfer-message-handler was not. Hence a check on the mechanism rather
 * than a third instance-level repair.
 *
 * Reading `sender_cid` for display or logging is fine; assigning it to the
 * identity field is not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'citadel-workspaces/src';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) yield full;
  }
}

// `senderCid: <anything>sender_cid<anything>` — the payload feeding the identity.
const OFFENDING = /senderCid\s*:\s*[^,\n}]*\bsender_cid\b/;

const offenders = [];
for (const file of walk(ROOT)) {
  if (file.includes('__tests__')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (OFFENDING.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
  });
}

if (offenders.length > 0) {
  console.error("A message's sender is being taken from the payload, not the transport:\n");
  for (const o of offenders) console.error(`  ${o}`);
  console.error('\n`sender_cid` is chosen by the sending peer. Use the `peerCid` parameter,');
  console.error('which is the authenticated channel identity. See message-handler-routing.ts.');
  process.exit(1);
}

console.log('Every inbound handler takes its sender from the transport.');
