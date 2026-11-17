/**
 * The hyphenation pattern files the UI hands cdoc-wasm, as citadel-docs
 * `crates/cdoc-para/patterns/manifest.json` lists them. The value is generated
 * (generated/pattern-manifest.ts); this is its shape and the port that serves a file's text.
 */

export interface PatternEntry {
  /** The tag cdoc-wasm registers it under and `hyphenation_patterns_needed` names (`de-1996`). */
  readonly tag: string;
  /** File name under the served pattern directory. */
  readonly file: string;
  readonly license: string;
  /** Lowercase hex sha256 of the file; a served file that differs is refused. */
  readonly sha256: string;
}

export interface PatternManifest {
  readonly source: string;
  readonly patterns: readonly PatternEntry[];
}

/** Where pattern text comes from. The browser adapter fetches; tests read files. */
export interface PatternSource {
  load(entry: PatternEntry): Promise<string>;
}
