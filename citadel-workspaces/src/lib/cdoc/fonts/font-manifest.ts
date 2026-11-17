/**
 * The faces the UI hands cdoc-wasm, as citadel-docs `fonts/manifest.json` lists them. The
 * value is generated (generated/font-manifest.ts); this is its shape and the port that serves
 * a face's bytes.
 */

export interface FontFaceEntry {
  /** File name under the served font directory. */
  readonly file: string;
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Lowercase hex sha256 of the file; a served face that differs is refused. */
  readonly sha256: string;
}

export interface FontManifest {
  readonly license: string;
  readonly licenseFile: string;
  readonly copyright: string;
  /** The family serving any family not added or aliased. */
  readonly fallback: string;
  /** Requested family → served family (Calibri → Carlito). */
  readonly aliases: Readonly<Record<string, string>>;
  readonly faces: readonly FontFaceEntry[];
}

/** Where face bytes come from. The browser adapter fetches; tests read files. */
export interface FontSource {
  load(face: FontFaceEntry): Promise<Uint8Array>;
}
