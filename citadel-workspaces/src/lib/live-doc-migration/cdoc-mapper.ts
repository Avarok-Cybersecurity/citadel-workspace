/**
 * The mapper port over cdoc-wasm's editor artefact (the product's only implementation): its
 * StarterKit importer, `tiptap_to_crdt_snapshot(json, client) -> Migrated` and
 * `tiptap_to_pm(json) -> string` (citadel-docs #49).
 *
 * The client id crosses into wasm as a u64, and wasm-bindgen does not refuse a BigInt outside
 * that range: it wraps it (2^64 + 5 arrives as 5, -1 as 2^64 - 1). A wrapped id would write the
 * snapshot as some other client, or as client 0, which cdoc reserves for the deterministic blank,
 * silently. So the range is kept here, before the call, and anything outside it is refused.
 */
import type { MappedSnapshot, MapperLoader, MigrationMapper } from './mapper-port';

type Glue = typeof import('../../../vendor/cdoc/cdoc_wasm_editor.js');

/** cdoc-wasm's `Migrated`. */
interface MigratedHandle {
  snapshot(): Uint8Array;
  reportJson(): string;
  free(): void;
}

export interface StarterKitImporter {
  readonly toSnapshot: (json: string, client: bigint) => MigratedHandle;
  readonly toPm: (json: string) => string;
}

/** The ids a migration snapshot may be written as: a non-zero u64. */
export const MIGRATION_CLIENT_MIN: bigint = 1n;
export const MIGRATION_CLIENT_MAX: bigint = (1n << 64n) - 1n;

function checkedClient(client: bigint): bigint {
  if (client < MIGRATION_CLIENT_MIN || client > MIGRATION_CLIENT_MAX) {
    throw new RangeError(`a migration's client id must be in 1..2^64-1, not ${client.toString()}: the engine would wrap it to another client`);
  }
  return client;
}

export function mapperOver(importer: StarterKitImporter): MigrationMapper {
  return {
    toSnapshot(starterKitJson: string, client: bigint): MappedSnapshot {
      const migrated: MigratedHandle = importer.toSnapshot(starterKitJson, checkedClient(client));
      try {
        return { snapshot: migrated.snapshot(), reportJson: migrated.reportJson() };
      } finally {
        migrated.free();
      }
    },
    toDocsPm: (starterKitJson: string): string => importer.toPm(starterKitJson),
  };
}

let loaded: Promise<MigrationMapper | null> | null = null;

/** One engine for every migration on this page; a failed load is retried on the next call. */
export const loadCdocMigrationMapper: MapperLoader = (): Promise<MigrationMapper | null> => {
  loaded ??= (async (): Promise<MigrationMapper | null> => {
    const glue: Glue = await import('../../../vendor/cdoc/cdoc_wasm_editor.js');
    const { loadCdocEditorWasm } = await import('@/lib/cdoc/engine/load-wasm');
    await loadCdocEditorWasm((): void => undefined);
    return mapperOver({ toSnapshot: glue.tiptap_to_crdt_snapshot, toPm: glue.tiptap_to_pm });
  })().catch((error: unknown): never => {
    loaded = null;
    throw error;
  });
  return loaded;
};
