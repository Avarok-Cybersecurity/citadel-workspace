#!/usr/bin/env node
/**
 * Nobody invents a peer's online status.
 *
 * `presence.ts` opens with a list of the four ways this dot had been wrong --
 * `Math.random()`, a demo-only map, a CID/username mix-up, and a "registered
 * with me" check under a green light. The fifth was underneath all of them: the
 * field itself was a plain boolean, so the absent fact was invented three
 * different ways at once.
 *
 *   discovery.ts   online_status !== undefined ? online_status : true   -> ONLINE
 *   registration.ts  isOnline: true                                     -> ONLINE
 *   polling.ts     online_status ?? false                               -> OFFLINE
 *
 * and `isPeerOnline` read "absent from the online set" as offline, which before
 * the first poll is every peer in the app. `presence.ts` then ORed the
 * registry's flag with the poll, so an invented `true` outranked the real
 * answer.
 *
 * `Peer.isOnline` is now `boolean | null`. This gate keeps the type that way
 * and forbids the literal inventions, because a type is only as good as the
 * values people put in it.
 *
 * `?? false` in the poller is deliberately still allowed: there, a peer the
 * backend did not list in a response it DID send is genuinely not online. The
 * distinction is whether an answer arrived, not whether the value is false.
 *
 * Node 18-compatible on purpose: the lint jobs run the oldest supported Node.
 */
import { readFileSync, existsSync } from 'node:fs';

const TYPES = 'src/lib/p2p-registration-service/types.ts';
const PRESENCE = 'src/lib/presence.ts';

const INVENTIONS = [
  {
    file: 'src/lib/p2p-registration-service/discovery.ts',
    pattern: /online_status\s*!==\s*undefined\s*\?[^:]*:\s*true/,
    why: 'invents "online" for a peer the agent said nothing about; use `?? null`',
  },
  {
    file: 'src/lib/presence.ts',
    pattern: /peerOnlineStatus\([^)]*\)\s*(?:===\s*true\s*)?\|\|/,
    why: 'ORs the live poll with the registry snapshot, so a stale or invented `true` outranks the fresh answer',
  },
];

if (!existsSync(TYPES) || !existsSync(PRESENCE)) {
  console.error(`::error::${TYPES} or ${PRESENCE} is missing -- this gate has nothing to check`);
  process.exit(1);
}

const failures = [];

const types = readFileSync(TYPES, 'utf8');
if (!/isOnline:\s*boolean\s*\|\s*null/.test(types)) {
  failures.push({
    file: TYPES,
    why: 'Peer.isOnline must stay `boolean | null`. Narrowing it back to boolean forces every caller to invent one of the two answers for a fact nobody has reported',
  });
}

const presence = readFileSync(PRESENCE, 'utf8');
if (!/export function isMemberOnline\([^)]*\):\s*boolean\s*\|\s*null/.test(presence)) {
  failures.push({
    file: PRESENCE,
    why: 'isMemberOnline must return `boolean | null`; "offline" is an assertion about somebody who may be sitting right there',
  });
}

for (const { file, pattern, why } of INVENTIONS) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
    if (pattern.test(line)) failures.push({ file, line: i + 1, why });
  });
}

if (failures.length > 0) {
  for (const f of failures) {
    const at = f.line === undefined ? '' : `,line=${f.line}`;
    console.error(`::error file=citadel-workspaces/${f.file}${at}::${f.why}.`);
  }
  process.exit(1);
}

console.log('  Presence: unknown is representable, and nobody invents it  ok');
