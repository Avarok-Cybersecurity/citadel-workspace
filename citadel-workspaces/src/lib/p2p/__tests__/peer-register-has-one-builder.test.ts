/**
 * One module builds the `PeerRegister` request: `lib/p2p/send-peer-registration.ts`.
 *
 * It was built in five places -- the discovery path, the auto-accept path, the
 * manual accept, the poll's resend and the Messages page's Available list --
 * and the copies had drifted: one sent CIDs as strings, one recorded nothing so
 * the request was never resent and the peer's answer met the stranger policy,
 * and one announced the peer as registered the moment the frame left. Each copy
 * is a place the frame can drift again, so a second construction fails here.
 *
 * Reads the source tree rather than importing anything: a construction is a
 * fact about the text, and a test that imported the modules could only see the
 * ones it thought to import.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC: string = join(__dirname, '..', '..', '..');
const AUTHORITY: string = 'lib/p2p/send-peer-registration.ts';

/** `PeerRegister:` or `"PeerRegister":` as an object key; not `PeerRegisterSuccess` and friends. */
const CONSTRUCTION: RegExp = /\bPeerRegister['"]?\s*:/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry: string): string[] => {
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' || entry === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

function isComment(line: string): boolean {
  const t: string = line.trimStart();
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
}

function constructions(): string[] {
  return sources(SRC).flatMap((file: string): string[] => {
    const rel: string = relative(SRC, file).split(sep).join('/');
    return readFileSync(file, 'utf8').split('\n')
      .map((line: string, i: number): string | null => (!isComment(line) && CONSTRUCTION.test(line) ? `${rel}:${i + 1}` : null))
      .filter((hit: string | null): hit is string => hit !== null);
  });
}

describe('the PeerRegister request', () => {
  const hits: string[] = constructions();

  it('is built in the authority, so the scan below can see a construction at all', () => {
    expect(hits.filter((h: string) => h.startsWith(`${AUTHORITY}:`)).length).toBeGreaterThan(0);
  });

  it('is built nowhere else', () => {
    expect(hits.filter((h: string) => !h.startsWith(`${AUTHORITY}:`))).toEqual([]);
  });

  it('is told apart from the responses that share its prefix', () => {
    expect(CONSTRUCTION.test('{ PeerRegisterSuccess: { request_id } }')).toBe(false);
    expect(CONSTRUCTION.test('{ "PeerRegister": { request_id } }')).toBe(true);
  });
});
