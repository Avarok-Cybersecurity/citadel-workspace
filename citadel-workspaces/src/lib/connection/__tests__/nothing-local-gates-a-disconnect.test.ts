/**
 * A disconnect must not queue behind a local write.
 *
 * Two instances of this were already found by hand. `handleLogout` persisted
 * the session list and then disconnected, so a `LocalDBSetKV` timeout left the
 * user signed out in the UI and still connected to the server (round 190).
 * `handleAuthSuccess` did the mirror: a local write that threw discarded a
 * completed registration (round 189).
 *
 * Both were written the same way for the same reason — the write looks like
 * bookkeeping that belongs with the state change, and the ordering only matters
 * when the write is slow. It is slow exactly when the agent is under load,
 * which is exactly when a user is most likely to be signing out.
 *
 * So the rule gets stated where it can be checked: in `lib/connection`, nothing
 * that writes to LocalDB may be awaited before a disconnect in the same
 * function. A guard rather than a third fix, because two independent instances
 * of one mistake is a pattern and the third would have been written the same
 * way.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR: string = resolve(__dirname, '..');

/** Calls that reach the agent's LocalDB, directly or through the IO seam. */
const LOCAL_WRITE: RegExp = /await\s+[\w.]*\.(storeSessionsToLocalDB|markUserDisconnected|sendLocalDBSet|setSelectedUser)\s*\(/;
const DISCONNECT: RegExp = /await\s+[\w.]*\.disconnect\s*\(/;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every top-level exported function body in the directory, by name. */
function functionBodies(): Array<{ file: string; name: string; body: string }> {
  const out: Array<{ file: string; name: string; body: string }> = [];
  for (const entry of readdirSync(DIR)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    const source: string = withoutComments(readFileSync(join(DIR, entry), 'utf-8'));
    const pattern: RegExp = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const rest: string = source.slice(match.index);
      const next: number = rest.slice(1).search(/\nexport\s/);
      out.push({ file: entry, name: match[1], body: next === -1 ? rest : rest.slice(0, next + 1) });
    }
  }
  return out;
}

describe('in lib/connection', () => {
  const bodies: { file: string; name: string; body: string; }[] = functionBodies();

  it('reads real function bodies, so the rule is not passing over nothing', () => {
    expect(bodies.length).toBeGreaterThan(10);
    expect(bodies.some((b) => DISCONNECT.test(b.body))).toBe(true);
  });

  it('nothing writes to LocalDB before it disconnects', () => {
    const offenders: string[] = bodies
      .filter((b) => DISCONNECT.test(b.body) && LOCAL_WRITE.test(b.body))
      .filter((b) => (b.body.search(LOCAL_WRITE) < b.body.search(DISCONNECT)))
      .map((b) => `${b.file}:${b.name}`);

    expect(offenders).toEqual([]);
  });
});
