/**
 * A write whose success variant is ALSO broadcast to other members must narrow
 * on the payload, or another member's write resolves it.
 *
 * Round 85 gave the server live tree updates by broadcasting `Node`,
 * `NodeDeleted` and `NodeMoved` to everyone. The write gate matches by type,
 * because the protocol carries no request id — so from that moment, any other
 * member's tree write could resolve a pending one here. `awaitWriteResponse`
 * has always taken a `matches` argument for exactly this case; it was passed
 * only for group messages.
 *
 * This scan is what keeps it passed. It is a text scan and knows it: what it
 * proves is that nobody added a broadcast-variant write without narrowing it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

/**
 * Request types known to have a broadcast answer. A FLOOR, not the list.
 *
 * This was the whole list, hand-maintained, and its own comment said so: "making
 * a variant a broadcast on the Rust side does not add it here". That is exactly
 * what happened. `UpdateWorkspace`, `UpdateWorkspaceTheme` and `CreateWorkspace`
 * all answer `Workspace`, which the server broadcasts to the other members AND
 * which `GetWorkspace` answers — so a concurrent read in the same tab, or a
 * colleague's theme save, resolved a pending rename. None was in this set, so
 * this test was green over all three.
 *
 * It is now DERIVED from the Rust command processor, with these kept as a floor
 * that may only grow — the same shape as `wire-maps-are-not-objects`, and the
 * answer to the original comment's worry: a derivation that silently shrinks is
 * caught by the floor rather than trusted.
 */
const KNOWN_BROADCAST_WRITES: Set<string> = new Set([
  'CreateNode',
  'UpdateNode',
  'DeleteNode',
  'MoveNode',
  'UpdateMemberRole',
  'CreateWorkspace',
  'UpdateWorkspace',
  'UpdateWorkspaceTheme',
]);

/** Where the Rust command processor is, from wherever the tests run. */
const RUST_CANDIDATES: readonly string[] = [
  join('..', 'citadel-workspace-server-kernel', 'src', 'kernel', 'command_processor', 'async_process_command.rs'),
  join('..', '..', 'citadel-workspace-server-kernel', 'src', 'kernel', 'command_processor', 'async_process_command.rs'),
];

/** Response variants the server hands to `broadcast*`. */
function broadcastVariants(): Set<string> | null {
  for (const candidate of RUST_CANDIDATES) {
    const full: string = join(process.cwd(), candidate);
    if (!existsSync(full)) continue;
    const rust: string = readFileSync(full, 'utf-8');
    const found: Set<string> = new Set<string>();
    for (const m of rust.matchAll(
      /broadcast(?:_to_\w+)?\s*\(\s*(?:\n\s*)?WorkspaceProtocolResponse::(\w+)/g,
    )) {
      found.add(m[1]);
    }
    return found;
  }
  return null;
}

/** Request types whose expected answer includes a broadcast variant. */
function derivedBroadcastWrites(gate: string, variants: Set<string>): Set<string> {
  const writes: Set<string> = new Set<string>();
  for (const m of gate.matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
    const [, requestType, listed] = m;
    for (const v of listed.matchAll(/'(\w+)'/g)) {
      if (variants.has(v[1])) writes.add(requestType);
    }
  }
  return writes;
}

const DIR: string = join(process.cwd(), 'src/lib/workspace-service');

describe('writes whose answer is also broadcast', () => {
  it('all narrow on the payload', async () => {
    const gate: string = readFileSync(join(DIR, 'await-write-response.ts'), 'utf-8');
    const variants: Set<string> | null = broadcastVariants();
    const derived: Set<string> = variants === null
      ? new Set<string>()
      : derivedBroadcastWrites(gate, variants);

    // The derivation SUPPLEMENTS the floor; it does not replace it.
    //
    // It cannot replace it: `DeleteNode` and `MoveNode` are broadcast as
    // `kernel.broadcast(response.clone(), ..)`, through a variable rather than a
    // literal variant, so no reasonable regex sees them. Asserting the floor was
    // a subset of the derivation failed on exactly those two — which is the
    // derivation being honest about its reach, not the code being wrong.
    //
    // What IS asserted is that the derivation found something. A grep that
    // matches nothing would otherwise leave this silently back on the
    // hand-maintained list the whole change was about.
    if (variants !== null) {
      expect(
        variants.size,
        'no broadcast variant was found in the Rust command processor — the call shape moved, ' +
          'so this test is back to a hand-maintained list without saying so',
      ).toBeGreaterThan(0);
    }

    const broadcastWrites: Set<string> = new Set([...KNOWN_BROADCAST_WRITES, ...derived]);
    const files: string[] = await fg(['**/*.ts'], { cwd: DIR, ignore: ['__tests__/**'] });

    const offenders: string[] = [];
    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(DIR, rel), 'utf-8'));
      for (const match of source.matchAll(/awaitWriteResponse\(\s*'(\w+)'([\s\S]*?)\)\s*;/g)) {
        const [, requestType, rest] = match;
        if (!broadcastWrites.has(requestType)) continue;
        // Two commas after the type means a third argument was passed.
        if ((rest.match(/,/g) ?? []).length < 2) {
          offenders.push(`${rel}: awaitWriteResponse('${requestType}', …) has no matcher`);
        }
      }
    }

    expect(
      offenders,
      'the server broadcasts this variant to every member, so type alone lets ' +
        "someone else's write resolve this one — and an editor save that resolves " +
        'on a stranger\'s broadcast closes the editor over the user\'s buffer',
    ).toEqual([]);
  });

  it('names request types that actually exist', async () => {
    const gate: string = readFileSync(join(DIR, 'await-write-response.ts'), 'utf-8');
    for (const requestType of KNOWN_BROADCAST_WRITES) {
      expect(gate, `${requestType} is not a mapped write`).toContain(`${requestType}:`);
    }
  });
});
