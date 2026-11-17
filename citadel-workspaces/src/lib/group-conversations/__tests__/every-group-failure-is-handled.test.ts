import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP_FAILURE_VARIANTS } from '../group-failure-variants';

/**
 * The failure arm's list must be exactly the failures the wire can carry.
 *
 * `group-events.ts` maps every `Group*Failure` to one `group:failed` event, and
 * the comment above that loop says, correctly, that "mapping them individually
 * is how the next one comes to be forgotten". It was then a hand-maintained
 * list — and it had drifted in BOTH directions at once: it named
 * `GroupJoinFailure` and `GroupDisconnectFailure`, neither of which exists in
 * the wire types, and omitted five that do.
 *
 * The expensive omission was `GroupRespondRequestFailure`. Accepting an
 * invitation commits the group locally first (`use-group-state-invite.ts`), so
 * when the server refused — a stale key, a group that ended, a responder who is
 * not the owner — no arm matched, no `group:failed` fired, and the user kept a
 * group in their sidebar the server never counted them into, typing into a
 * channel nobody would receive. That is the exact outcome `group-events.ts`'s
 * own header describes as the bug it was written to fix, for a different
 * variant.
 *
 * Both directions are asserted, and neither is sufficient alone. "Every real
 * variant is listed" passes for a list that also contains fiction — which is
 * what shipped. "Every listed name is real" passes for a list of one.
 *
 * The generated types are the source of truth rather than the Rust enum: they
 * are what the browser actually receives, and they live in the submodule this
 * package already depends on.
 */
/**
 * Where the generated types are, tried in order.
 *
 * NOT `require.resolve`. The package's `exports` map declares only `"."`, so
 * `require.resolve('citadel-internal-service-wasm-client/package.json')` is
 * blocked by design — the first two versions of this test failed everywhere,
 * including the parent checkout where the app resolves the package perfectly
 * well, and the message blamed the worktree rather than the exports map.
 *
 * These are plain filesystem paths, in the order they occur: the package linked
 * into this workspace, the same link one level up (where npm hoists it when the
 * UI is checked out inside the parent, which is what CI does), and the
 * submodule source it is linked from.
 */
const CANDIDATES: readonly string[] = [
  join('node_modules', 'citadel-internal-service-wasm-client', 'src', 'types'),
  join('..', 'node_modules', 'citadel-internal-service-wasm-client', 'src', 'types'),
  join('..', 'citadel-internal-service', 'typescript-client', 'src', 'types'),
];

function generatedTypesDir(): string | null {
  for (const candidate of CANDIDATES) {
    const full: string = join(process.cwd(), candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

function generatedFailureVariants(): string[] {
  const dir: string | null = generatedTypesDir();
  if (dir === null || !existsSync(dir)) {
    throw new Error(
      'the generated types are at none of the known locations, so nothing here was checked. ' +
        'They are absent in a standalone worktree of this submodule; CI checks out the parent.',
    );
  }
  return readdirSync(dir)
    .filter((f) => /^Group\w*Failure\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

describe('the group failure arm', () => {
  it('can see the generated types at all', () => {
    // Floor. Every assertion below compares against this directory; if it moved,
    // they would all pass over an empty list and report the arm as complete.
    const dir: string | null = generatedTypesDir();
    expect(
      dir,
      `the generated types are at none of ${CANDIDATES.length} known locations, so this test ` +
        'examined nothing. They are absent in a standalone worktree of this submodule; CI ' +
        'checks out the parent, where they are one level up.',
    ).not.toBeNull();
    expect(generatedFailureVariants().length).toBeGreaterThan(5);
  });

  it('lists every failure variant the wire can carry', () => {
    const missing: string[] = generatedFailureVariants().filter(
      (v) => !GROUP_FAILURE_VARIANTS.includes(v),
    );
    expect(
      missing,
      'these failures arrive and no arm matches them, so nothing tells the user the ' +
        'operation was refused — and an optimistically-applied local change is never undone',
    ).toEqual([]);
  });

  it('lists nothing the wire cannot carry', () => {
    const generated: string[] = generatedFailureVariants();
    const fictional: string[] = GROUP_FAILURE_VARIANTS.filter((v) => !generated.includes(v));
    expect(
      fictional,
      'these names exist in no generated type, so they are dead branches that read as coverage',
    ).toEqual([]);
  });
});
