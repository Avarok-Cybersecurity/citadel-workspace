// @vitest-environment node
/**
 * A migration's snapshot is written as a client id the engine takes as a u64. wasm-bindgen does
 * not refuse a BigInt outside that range: it wraps it, so 2^64 + 5 would write as client 5 and
 * 2^64 as client 0 (the deterministic blank's), silently. The mapper keeps the id in 1..2^64-1
 * before the call, and refuses the rest without calling the engine.
 *
 * Over the real vendored engine and what the earlier chat editor really stored.
 */
import { describe, expect, it } from 'vitest';
import * as glue from '../../../../vendor/cdoc/cdoc_wasm_editor.js';
import { realWasm } from '@/lib/cdoc/__tests__/wasm-rig';
import { mapperOver, MIGRATION_CLIENT_MAX, MIGRATION_CLIENT_MIN, type StarterKitImporter } from '../cdoc-mapper';
import { walkYjsState } from '../yjs-walker';
import type { MigrationMapper } from '../mapper-port';
import { recordedUpdate } from './fixtures';

const JSON_IN: string = JSON.stringify(walkYjsState(recordedUpdate('sample')).pm);
const TWO_64: bigint = 1n << 64n;

const engine = (): StarterKitImporter => {
  realWasm(); // instantiates the glue's binary, read from disk
  return { toSnapshot: glue.tiptap_to_crdt_snapshot, toPm: glue.tiptap_to_pm };
};

const bytesAs = (client: bigint): Uint8Array => {
  const migrated: ReturnType<StarterKitImporter['toSnapshot']> = engine().toSnapshot(JSON_IN, client);
  try {
    return migrated.snapshot();
  } finally {
    migrated.free();
  }
};

describe('the client id a migration is written as', () => {
  it('would be wrapped by the engine itself, which is why the mapper keeps the range', () => {
    expect(Array.from(bytesAs(TWO_64 + 5n))).toEqual(Array.from(bytesAs(5n)));
  });

  it('is written as given at both ends of the range, deterministically', () => {
    const mapper: MigrationMapper = mapperOver(engine());
    for (const client of [MIGRATION_CLIENT_MIN, MIGRATION_CLIENT_MAX]) {
      const first: Uint8Array = mapper.toSnapshot(JSON_IN, client).snapshot;
      expect(Array.from(mapper.toSnapshot(JSON_IN, client).snapshot)).toEqual(Array.from(first));
    }
    expect(Array.from(mapper.toSnapshot(JSON_IN, MIGRATION_CLIENT_MAX).snapshot)).not.toEqual(Array.from(mapper.toSnapshot(JSON_IN, MIGRATION_CLIENT_MIN).snapshot));
  });

  it('is refused outside 1..2^64-1, before the engine is called', () => {
    const calls: bigint[] = [];
    const real: StarterKitImporter = engine();
    const mapper: MigrationMapper = mapperOver({ ...real, toSnapshot: (json: string, client: bigint) => { calls.push(client); return real.toSnapshot(json, client); } });
    for (const outside of [0n, -1n, TWO_64, TWO_64 + 5n]) {
      expect(() => mapper.toSnapshot(JSON_IN, outside)).toThrow(RangeError);
    }
    expect(calls).toEqual([]);
  });
});
