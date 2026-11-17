#!/usr/bin/env node
/**
 * "Which session is this?" is answered in one place.
 *
 * `lib/p2p/current-cid.ts` documents the priority and the reason for it:
 * instance manager first (synchronous, set on connect), then the tab's
 * selection, then the tab's stored session, and only then the global
 * connection — which belongs to the CONNECTION, not to this tab, and is wrong
 * whenever a browser holds two sessions.
 *
 * There were three answers. `p2p/messenger-cid-resolver.ts` carried its own
 * copy of the chain with its own 500ms literal where the authority uses
 * `CID_LOOKUP_TIMEOUT_MS`; `CallLayer` passed
 * `connectionManager.getConnectionInfo()?.cid` alone, which is the last resort
 * used as the only resort. So the messenger, the call layer and the auto-connect
 * service could each decide a message belonged to a different session.
 *
 * Two rules:
 *   - only the authority may implement the chain;
 *   - a `getCurrentCid` supplied to a service may not be the bare connection
 *     lookup, which is the fallback masquerading as the answer.
 *
 * Node 18-compatible on purpose: the lint jobs run the oldest supported Node.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AUTHORITY = 'src/lib/p2p/current-cid.ts';
const SRC = 'src';

/** Reads the tab's own selection: implementing the chain is this file's job. */
const MAY_IMPLEMENT = [AUTHORITY];

/**
 * The chain, recognised by all three of its distinctive reads at once.
 *
 * A first version matched any TWO of {getSelectedUser, getTabSelectedSession,
 * instanceManager.cid} and reported ten files, of which eight were innocent:
 * reading the tab's selection and its stored session is simply how you answer
 * "who is on this tab", for a USERNAME as much as for a CID. What makes it this
 * chain is falling all the way through to the global connection as well.
 */
const MARKERS = [/instanceManager\.cid/, /selectedCid/, /getConnectionInfo\(\)/];

/**
 * The last resort, handed over as if it were the answer.
 *
 * `[\s\S]` and not `[^\n]`: the first version was line-oriented, and prettier
 * wraps a `getCurrentCid:` whose body needs a local. `useConnectionHandler.ts`
 * spelled it across four lines —
 *
 *     getCurrentCid: async () => {
 *       const info = connectionManager.getConnectionInfo();
 *       return info?.cid ?? null;
 *     },
 *
 * — and handed that to revfs, which uses it as the local CID for every P2P
 * operation. The gate printed its constant success line over it. This is the
 * same blindness the broadcast-audience gate had, found the same way: a control
 * that reintroduced the defect in the shape the formatter actually produces.
 *
 * And `.cid` need not be ADJACENT to the lookup. Widening `[^\n]` to `[\s\S]`
 * was not enough, and its control proved it: the wrapped form assigns the info
 * to a local first —
 *
 *     const info = connectionManager.getConnectionInfo();
 *     return info?.cid ?? null;
 *
 * — so `getConnectionInfo()` is followed by `;`, never by `?.cid`. Both the
 * original detector and the first attempt at fixing it required that adjacency.
 * The read of `.cid` is now looked for separately, within the same bounded
 * window.
 *
 * Bounded to 300/200 characters so the match cannot run away across a file and
 * pair a `getCurrentCid` in one function with a connection lookup in another.
 */
const BARE_CONNECTION_CID =
  /getCurrentCid[\s\S]{0,300}?connectionManager\.getConnectionInfo\(\)[\s\S]{0,200}?\.\s*cid/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let info;
    try { info = statSync(p); } catch { continue; }
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

let authority;
try {
  authority = readFileSync(AUTHORITY, 'utf8');
} catch {
  console.error(`::error::${AUTHORITY} is missing -- the single answer this gate protects is gone`);
  process.exit(1);
}
if (!/export async function getCurrentCid/.test(authority)) {
  console.error(`::error file=citadel-workspaces/${AUTHORITY}::getCurrentCid is gone; every caller this gate redirects has nowhere to go`);
  process.exit(1);
}

const offences = [];
for (const file of walk(SRC)) {
  const rel = file.split('\\').join('/');
  const text = readFileSync(file, 'utf8');

  if (!MAY_IMPLEMENT.includes(rel)) {
    if (MARKERS.every((marker) => marker.test(text))) {
      offences.push({
        file: rel,
        why: `re-implements the CID priority chain. Import getCurrentCid from ${AUTHORITY} instead -- two answers to "which session is this" is how a message lands in the wrong one`,
      });
    }
  }

  // Against the WHOLE text, not line by line.
  //
  // This was `text.split('\n').findIndex(line => RE.test(line))`, so no
  // multi-line pattern could ever match here however the regex was written --
  // and the live offender spans four lines. Widening the pattern twice changed
  // nothing, because the pattern was never the thing that was line-oriented.
  // The line number is recovered from the match index instead.
  const bareMatch = BARE_CONNECTION_CID.exec(text);
  if (bareMatch !== null) {
    offences.push({
      file: rel,
      line: text.slice(0, bareMatch.index).split('\n').length,
      why: 'supplies the global connection CID as getCurrentCid. That is the LAST step of the chain used as the only step, and it is the connection\'s identity rather than this tab\'s',
    });
  }
}

if (offences.length > 0) {
  for (const o of offences) {
    const at = o.line === undefined ? '' : `,line=${o.line}`;
    console.error(`::error file=citadel-workspaces/${o.file}${at}::this file ${o.why}.`);
  }
  process.exit(1);
}

console.log('  Session identity: one implementation of the CID chain, no bare fallbacks  ok');
