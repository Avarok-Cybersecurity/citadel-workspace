/**
 * The peer list read `full_name` and `is_online`. The generated
 * `PeerInformation` declares `name` and `online_status`, so both reads were
 * `undefined` on every peer — the sidebar showed every discovered peer as
 * offline and unnamed. Optional fields kept tsc silent.
 *
 * And `peer_information` is a Rust HashMap, which crosses the WASM boundary as a
 * JS Map: `Object.values()` on one returns [], so the primary discovery path
 * found nothing at all and fell through to a fallback that only sees peers on
 * the same internal service.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wireMapValues, wireMapEntries } from '@/lib/wire-map';

describe('wireMapEntries', () => {
  it('reads a Map, which is what the WASM boundary actually delivers', () => {
    const wire: Map<bigint, { cid: bigint; }> = new Map<bigint, { cid: bigint }>([[7n, { cid: 7n }]]);
    expect(wireMapValues(wire, 'test')).toEqual([{ cid: 7n }]);
    expect(wireMapEntries(wire, 'test')).toEqual([['7', { cid: 7n }]]);
  });

  it('still reads a plain object, which JSON-parsed payloads really are', () => {
    expect(wireMapValues({ '7': { cid: 7n } }, 'test')).toEqual([{ cid: 7n }]);
  });

  it('returns nothing for null rather than throwing', () => {
    expect(wireMapValues(null, 'test')).toEqual([]);
  });
});

describe('the peer discovery reader', () => {
  const source: string = readFileSync(
    join(process.cwd(), 'src/components/p2p/peer-discovery-requests.ts'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('reads the field names the generated PeerInformation declares', () => {
    expect(source).toContain('online_status');
    expect(source).toContain('p.name');
  });

  it('does not read the fields that never existed', () => {
    expect(source, 'full_name is not a field of PeerInformation').not.toContain('full_name');
    expect(source, 'is_online is not a field of PeerInformation').not.toMatch(/p\.is_online/);
  });

  it('does not treat a wire HashMap as a plain object', () => {
    expect(source).not.toMatch(/Object\.(values|keys|entries)\(\s*response\./);
  });
});

/**
 * The same HashMap hazard in the two places it reaches persisted state. The
 * normalizer existed in ONE module and was never propagated, so these two read
 * `[]` from a populated Map: no message-history page index after a reload, and
 * no cached-peer sync after a reconnect.
 */
describe('every wire HashMap read', () => {
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const FILES: string[] = [
    'src/lib/websocket/local-db-operations.ts',
    'src/lib/p2p-registration-service/connection.ts',
    'src/components/p2p/peer-discovery-requests.ts',
  ];

  it.each(FILES)('%s does not use Object.* on a wire map', (file) => {
    const src: string = strip(readFileSync(join(process.cwd(), file), 'utf8'));

    // The specific shapes that silently return nothing on a Map.
    expect(src).not.toMatch(/Object\.(keys|values|entries)\(\s*(response|r|map|peerConnections)\b/);
  });

  it('routes them through the shared normalizer instead', () => {
    for (const file of FILES) {
      // Imports stripped as well as comments, and a CALL required.
      //
      // This asserted `toMatch(/wireMap(Entries|Values)/)` against raw source,
      // and every one of these files opens with
      // `import { wireMapEntries } from '@/lib/wire-map'`. The import line
      // satisfied it. Replacing the call with a hand-rolled Object.entries
      // loop left this green -- which is the one thing it exists to catch.
      const src: string = strip(readFileSync(join(process.cwd(), file), 'utf8'))
        .replace(/^\s*import[^;]*;/gm, '');

      expect(src, `${file} should CALL wireMapEntries/wireMapValues, not merely import it`)
        .toMatch(/\bwireMap(Entries|Values)\s*(?:<[^>]*>)?\(/);
    }
  });
});
