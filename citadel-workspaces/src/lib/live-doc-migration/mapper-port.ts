/**
 * The mapper port: StarterKit ProseMirror JSON (the walker's output) into Citadel Docs.
 *
 * Contract, for the engine's adapter (cdoc-mapper.ts) and anything that stands in for it:
 *
 *  - `toSnapshot(starterKitJson, client)` is cdoc-wasm's `tiptap_to_crdt_snapshot(pm_json,
 *    client) -> Migrated`: the CRDT snapshot written as `client`, and the `{"report",
 *    "problems"}` JSON that conversion-report.ts reads. It must be DETERMINISTIC: the same JSON
 *    and client give byte-identical bytes on every device, which is what lets two devices'
 *    migrations of the same Yjs state merge as a no-op. It throws on input it cannot map.
 *  - `toDocsPm(starterKitJson)` is the same mapping to Citadel Docs' own ProseMirror JSON (the
 *    static `pm` DocumentSource), for showing the original read-only. It throws when it cannot.
 *
 * `loadMapper` answers null when this build's engine has no StarterKit mapper yet: nothing is
 * migrated (and no marker written) until one ships, and "Show original" falls back to text.
 */

export interface MappedSnapshot {
  readonly snapshot: Uint8Array;
  /** `{"report": {"losses": [...]}, "problems": [...]}`. */
  readonly reportJson: string;
}

export interface MigrationMapper {
  toSnapshot(starterKitJson: string, client: bigint): MappedSnapshot;
  toDocsPm(starterKitJson: string): string;
}

export type MapperLoader = () => Promise<MigrationMapper | null>;
