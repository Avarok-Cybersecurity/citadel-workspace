#!/usr/bin/env node
/**
 * A listener and an emitter are two ends of one mechanism. This campaign has
 * repeatedly found only one end built: a handler subscribed to a name nothing
 * emits reads as working code, runs no code, and shows no error.
 *
 * Asserting the name in a test proves nothing — the broken version has a name
 * too. The only assertion with discriminating power is that the listened-for
 * name appears on the emitting side, which is what this script checks across
 * the whole tree.
 *
 * Test files are excluded from BOTH sides on purpose: an event emitted only by
 * its own test is exactly the failure being hunted, so counting the test as an
 * emitter would hide it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Known-dead listeners with an open finding already recorded against them.
 * An entry here is a debt marker, not an exemption: it keeps CI green while the
 * feature behind it is unbuilt, and the reason must name the finding.
 */
const RECORDED_DEAD = new Map([
  // Revealed only once this guard learned the `workspaceEvents.on*Event` and
  // `this.listen` facades — they were invisible to it until then, which is why
  // eight arrived at once rather than one at a time.
  ['typing:started', 'a redundant second path; typing DOES work via messenger.onTyping() in useP2PMessages-subscriptions'],
  ['typing:stopped', 'as typing:started — the working path is the onTyping callback, not this event'],
  ['message:received', 'the live inbound path is the P2P messenger; this listener predates it'],
  // Not "the banner has its own state" -- it has not: the banner reads
  // `state.protocolWarning`, which ONLY this listener writes, so the whole
  // feature has never rendered. It stays because the obvious producer is wrong:
  // the response handler's "unhandled variant" branch is the normal path for
  // every write an awaiting caller matches through `workspace:raw-response`,
  // and a banner on ordinary success teaches people to ignore banners. See the
  // note on the component.
  ['protocol:warning', 'listener and banner exist; no producer can yet tell an anomaly from a response somebody else handles'],
  ['notification', 'notification-service listens to its own bus name; every real producer calls addNotification directly'],
  ['user:login', 'EventListenerManager base-class example subscriptions; no producer anywhere'],
  ['user:logout', 'as user:login'],
]);


/**
 * Events that are EMITTED and heard by nobody.
 *
 * The mirror of RECORDED_DEAD. Most are harmless — an event published for a
 * consumer that does not exist yet is not a defect — which is why this is a
 * debt-marker list rather than a blanket failure. The ones marked REAL GAP are
 * findings with user-visible consequences, kept here so they are visible rather
 * than quietly tolerated.
 *
 * Three emit wires with no listener have already cost real defects: a live
 * document's final save, a failed session startup, and the local agent being
 * unreachable. Each was found by an audit, months apart, because nothing checked
 * this direction.
 */
const RECORDED_UNCONSUMED = new Map([
  // Newly VISIBLE, not newly dead: the whole file-transfer:* family was named
  // by constants, which this scan could not see until it learned to resolve
  // them. Every one of these fires alongside file-transfer:state-changed, which
  // the Files sidebar does listen to, so nothing is missing a refresh -- they
  // are finer-grained events kept for consumers that do not exist yet.
  // Not request-received: an arriving offer emits it WITHOUT state-changed, and the first-offer prompt listens.
  ['file-transfer:request-sent', 'the sender sees its own bubble, which reads the message; state-changed drives the sidebar'],
  ['file-transfer:progress-updated', 'progress is rendered from the transfer record; state-changed drives the sidebar'],
  ['outbound-error', 'duplicates the outbound-ack the caller already receives: channel-messaging calls acknowledge() and emits the ack on the same path'],
  ['group:message:new', 'published beside group:message-received, which is the one the store reads'],
  ['workspace:sign-in-settings', 'published beside the raw response, which is what the sign-in settings port reads; the kernel broadcasts no changes, so no view needs it yet'],
  ['group:message:edited', 'the edit path settles through awaitWriteResponse, not this event'],
  ['group:message:deleted', 'as group:message:edited'],
  ['group:message:single', 'no consumer; single-message fetch is unused by the UI'],
  ['group:messages:loaded', 'the node chat reads each page from the message manager the response handler fills (node-chat-io)'],
  ['instance:state-changed', 'diagnostic; the UI reads instanceManager directly'],
  ['member:loaded', 'the members list is driven by members:loaded (plural)'],
  // The note this replaces said "node types are read synchronously from the
  // store". There is no such store: nothing in src/ consumes a NodeTypes
  // response, and nothing ever SENDS ListNodeTypes either -- the only mention
  // of it is the response-shape table in workspace-service/service.ts. The
  // custom node-type feature exists end to end on the server and has a
  // Permission::ManageNodeTypes, and the UI implements neither half. Recorded
  // as the feature gap it is, rather than as a mechanism that does not exist.
  ['node:types:loaded', 'the UI never requests ListNodeTypes and has no node-type store; the feature is server-only for now'],
  ['operation:deleted', 'no consumer; deletions are reflected by the node:* events'],
  ['p2p:conversations-cleaned', 'diagnostic after a stale-conversation sweep'],
  ['p2p:peer-registered-with-us', 'the peer list refreshes on its own poll'],
  ['p2p:presence-updated', 'presence renders from the messenger callback registry'],
  ['p2p:registration-declined', 'no consumer — a decline is not surfaced anywhere'],
  ['broadcast-workspace-response', 'internal to the broadcast-channel service'],
]);

// Event names given as constants, resolved to their literals.
//
// The scan matched single-quoted arguments only, so a family declared as
// `export const FILE_TRANSFER_EVENTS = { COMPLETED: 'file-transfer:completed' }`
// and used as `emit(FILE_TRANSFER_EVENTS.COMPLETED)` was invisible on BOTH
// sides -- listeners and emitters alike. Deleting both emits of COMPLETED stops
// the Files sidebar ever refreshing, and this guard still reported every
// listener matched, because it could not see either half.
//
// Resolving the constants first means the rest of the scan works unchanged: a
// `NAME.MEMBER` reference is rewritten to the literal it stands for before the
// emitter and listener patterns run.
const CONST_FAMILY = /export const (\w+_EVENTS)\s*=\s*\{([^}]*)\}/g;
const CONST_MEMBER = /(\w+)\s*:\s*'([^']+)'/g;

function eventConstants(sources) {
  const byReference = new Map();
  for (const source of sources) {
    for (const family of source.matchAll(CONST_FAMILY)) {
      for (const member of family[2].matchAll(CONST_MEMBER)) {
        byReference.set(`${family[1]}.${member[1]}`, member[2]);
      }
    }
  }
  return byReference;
}

/** `EVENTS.COMPLETED` -> `'file-transfer:completed'`, so the scan can see it. */
function inlineConstants(source, byReference) {
  let out = source;
  for (const [reference, literal] of byReference) {
    out = out.split(reference).join(`'${literal}'`);
  }
  return out;
}

// Emitter forms: eventEmitter.emit('x'), io.emitEvent('x'), and the
// `name: 'x'` literal used by the group-events translator, whose names are
// emitted later through a dynamic `emit(event.name, ...)`.
const EMIT_PATTERNS = [/\bemit(?:Event)?\(\s*'([^']+)'/g, /\bname:\s*'([^']+)'/g];
// Listener forms — ALL SIX subscription facades on this bus.
//
// Round forty-one recorded that the reverse direction (an emitter nobody hears)
// could not be mechanised because a naive scan reported 75 false positives. The
// cause was this list being incomplete: `workspaceEvents.on*Event` is a family
// of six, `this.listen` is the EventListenerManager base class, and a generic
// type parameter — `useEventListener<Payload>('x')` — defeated the pattern
// entirely. With all of them recognised the false positives drop to zero.
//
// Deliberately NOT a bare `.on(` — Yjs documents, awareness and the editor use
// that too, and their event names are not on this bus.
const GENERIC = String.raw`(?:<[^>()]*>)?`;
const LISTEN_PATTERNS = [
  new RegExp(String.raw`eventEmitter\.(?:on|once)${GENERIC}\(\s*'([^']+)'`, 'g'),
  new RegExp(String.raw`useEventListener${GENERIC}\(\s*'([^']+)'`, 'g'),
  new RegExp(String.raw`\.on[A-Z]\w*Event${GENERIC}\(\s*'([^']+)'`, 'g'),
  // `this.listen`, and a `listen` handed in as a parameter -- `bindOutgoingFileOffers`
  // takes the manager's `this.listen` that way, so the bus stays out of its tests.
  new RegExp(String.raw`(?:this\.|\b)listen(?:Once)?${GENERIC}\(\s*'([^']+)'`, 'g'),
];
const LISTEN_ARRAY = new RegExp(String.raw`useEventListeners${GENERIC}\(\s*\[([^\]]*)\]`, 'g');

// `for (const event of NAMES) eventEmitter.on(event, handler)`.
//
// Subscribing from a named list is ordinary and readable — `use-permission`
// keeps the events after which a permission answer may differ in
// `RETRY_AGAIN_AFTER`, with a paragraph on each explaining why it is there —
// and this check could not see any of it. Adding a fourth entry to that list
// therefore failed the build with "nothing subscribes to it", about an event
// with a subscriber twelve lines further down.
//
// A gate that cannot see a pattern the codebase actually uses reports the
// codebase as broken, and gets switched off for it.
const LOOP_SUBSCRIBE = new RegExp(
  String.raw`for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)[\s\S]{0,200}?eventEmitter\.(?:on|once)${GENERIC}\(\s*\1\b`,
  'g',
);
/** `const NAMES: readonly string[] = [ 'a', 'b' ];` — the literals in it. */
function literalsOfArray(src, name) {
  const declaration = new RegExp(String.raw`const\s+${name}\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]`);
  const found = declaration.exec(src);
  if (!found) return [];
  return [...found[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const isTest = (p) => p.includes('__tests__') || /\.test\.[tj]sx?$/.test(p);

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); }
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})(SRC);

const emitted = new Set();
const listened = new Map(); // name -> [file, ...]

// Read every file once, resolve the constant families across all of them, then
// scan. The families are declared in one module and used from others, so this
// cannot be done file by file.
const sources = new Map();
for (const file of files) {
  if (isTest(file)) continue;
  sources.set(file, readFileSync(file, 'utf8'));
}
const constants = eventConstants(sources.values());
if (constants.size === 0) {
  console.error(
    'check-event-listeners-have-emitters: no *_EVENTS constant families found. ' +
      'They used to be invisible to this scan entirely; finding none now means ' +
      'the declaration shape changed and half the bus is unguarded again.',
  );
  process.exit(1);
}

for (const [file, raw] of sources) {
  const src = inlineConstants(raw, constants);
  for (const re of EMIT_PATTERNS) for (const m of src.matchAll(re)) emitted.add(m[1]);
  for (const re of LISTEN_PATTERNS) {
    for (const m of src.matchAll(re)) {
      if (!listened.has(m[1])) listened.set(m[1], []);
      listened.get(m[1]).push(relative(SRC, file));
    }
  }
  for (const m of src.matchAll(LISTEN_ARRAY)) {
    for (const n of m[1].matchAll(/'([^']+)'/g)) {
      if (!listened.has(n[1])) listened.set(n[1], []);
      listened.get(n[1]).push(relative(SRC, file));
    }
  }
  for (const m of src.matchAll(LOOP_SUBSCRIBE)) {
    for (const name of literalsOfArray(src, m[2])) {
      if (!listened.has(name)) listened.set(name, []);
      listened.get(name).push(relative(SRC, file));
    }
  }
}

const dead = [];
const staleMarkers = [];
for (const [name, sites] of listened) {
  if (emitted.has(name)) {
    if (RECORDED_DEAD.has(name)) staleMarkers.push(name);
  } else if (!RECORDED_DEAD.has(name)) {
    dead.push([name, sites]);
  }
}

// The reverse direction: an emitter nobody hears.
const unconsumed = [];
const staleUnconsumed = [];
for (const name of emitted) {
  // Only bus-shaped names. The `name: 'x'` emitter form also matches theme
  // presets and MDX template titles, which are not events.
  if (!name.includes(':') && !name.includes('-')) continue;
  if (listened.has(name)) {
    if (RECORDED_UNCONSUMED.has(name)) staleUnconsumed.push(name);
  } else if (!RECORDED_UNCONSUMED.has(name)) {
    unconsumed.push(name);
  }
}

// The OTHER direction of staleness, which was not checked at all.
//
// An entry is removed when it gains a listener. An entry whose EMITTER has gone
// -- 'workspace:created' and 'workspace:error' are both type declarations with
// no emit anywhere -- sat here indefinitely, and would have silently excused a
// future zero-subscriber emit of the same name. Same for RECORDED_DEAD entries
// whose listener has gone.
const vanishedUnconsumed = [...RECORDED_UNCONSUMED.keys()].filter((n) => !emitted.has(n));
const vanishedDead = [...RECORDED_DEAD.keys()].filter((n) => !listened.has(n));

for (const name of vanishedUnconsumed) {
  console.error(`\nVANISHED: '${name}' is in RECORDED_UNCONSUMED but nothing emits it any more.`);
  console.error(`  Remove the entry rather than letting it excuse a future emit of that name.`);
}
for (const name of vanishedDead) {
  console.error(`\nVANISHED: '${name}' is in RECORDED_DEAD but nothing subscribes to it any more.`);
  console.error(`  Remove the entry rather than letting it excuse a future dead listener.`);
}

for (const name of unconsumed) {
  console.error(`\nUNHEARD EMIT: '${name}' is emitted but nothing subscribes to it.`);
  console.error(`  Either subscribe to it, stop emitting it, or add it to`);
  console.error(`  RECORDED_UNCONSUMED with the reason it has no consumer yet.`);
}
for (const name of staleUnconsumed) {
  console.error(`\nSTALE MARKER: '${name}' is in RECORDED_UNCONSUMED but now HAS a listener.`);
  console.error(`  Remove the entry so a future regression fails.`);
}

if (
  dead.length === 0 &&
  staleMarkers.length === 0 &&
  unconsumed.length === 0 &&
  staleUnconsumed.length === 0 &&
  vanishedUnconsumed.length === 0 &&
  vanishedDead.length === 0
) {
  const n = listened.size - RECORDED_DEAD.size;
  console.log(
    `Every one of ${n} subscribed events has an emitter, and every emit has a ` +
    `listener (${RECORDED_DEAD.size} recorded-dead, ${RECORDED_UNCONSUMED.size} recorded-unheard).`
  );
  process.exit(0);
}

for (const [name, sites] of dead) {
  console.error(`\nDEAD LISTENER: '${name}' is subscribed but nothing emits it.`);
  for (const s of sites) console.error(`    ${s}`);
  console.error(`  The handler will never run. Either emit it from the producing side,`);
  console.error(`  delete the subscription, or add it to RECORDED_DEAD with the finding.`);
}
for (const name of staleMarkers) {
  console.error(`\nSTALE MARKER: '${name}' is in RECORDED_DEAD but now HAS an emitter.`);
  console.error(`  The debt was paid — remove the entry so a future regression fails.`);
}
process.exit(1);
