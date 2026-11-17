/* tslint:disable */
/* eslint-disable */

/**
 * Faces, images and the time a render uses, handed in from JavaScript.
 */
export class RenderAssets {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds a face (TrueType or OpenType bytes).
     */
    addFont(family: string, bold: boolean, italic: boolean, bytes: Uint8Array): void;
    /**
     * Adds an image under the content id documents refer to it by.
     */
    addImage(content_id: string, mime: string, bytes: Uint8Array): void;
    /**
     * Compiles a hyphenation pattern file by its manifest tag (`de-1996`); a language with no
     * file registered is not hyphenated.
     */
    addPatterns(tag: string, text: string): void;
    /**
     * Serves `target` whenever a document asks for `name` (e.g. Calibri → Carlito).
     */
    aliasFont(name: string, target: string): void;
    /**
     * No faces or images yet. `fallback_family` serves any family not added or aliased;
     * `now_rfc3339` (e.g. `new Date().toISOString()`) is the time the PDF records.
     */
    constructor(fallback_family: string, now_rfc3339: string);
}

/**
 * A blank document as model JSON.
 */
export function blank_model_json(): string;

/**
 * A blank document as ProseMirror JSON.
 */
export function blank_pm_json(): string;

/**
 * Check a ProseMirror JSON tree against the schema; throws naming the first violation.
 */
export function check_pm(pm_json: string): void;

/**
 * The manifest tags (`crates/cdoc-para/patterns/manifest.json`) of the hyphenation pattern
 * files a model document needs, as a JSON array: register these before laying it out.
 */
export function hyphenation_patterns_needed(model_json: string): string;

/**
 * The list label of every paragraph, in ProseMirror paragraph order, as a JSON array of
 * strings and nulls.
 */
export function list_labels(pm_json: string): string;

/**
 * Model JSON → ProseMirror JSON.
 */
export function model_to_pm(model_json: string): string;

/**
 * ProseMirror JSON → model JSON.
 */
export function pm_to_model(pm_json: string): string;

/**
 * ProseMirror JSON → PDF bytes.
 */
export function pm_to_pdf(pm_json: string, assets: RenderAssets): Uint8Array;

/**
 * ProseMirror JSON → a JSON array of SVG page documents for the paged preview.
 */
export function pm_to_svg_pages(pm_json: string, assets: RenderAssets): string;

/**
 * The ProseMirror schema as JSON.
 */
export function schema_json(): string;

/**
 * Validate a model document; returns a JSON array of error messages, empty when valid.
 */
export function validate_model(model_json: string): string;

/**
 * The crate version, so the UI can log which build it loaded.
 */
export function version(): string;

/**
 * Words in the body of a model document.
 */
export function word_count(model_json: string): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_renderassets_free: (a: number, b: number) => void;
    readonly blank_model_json: () => [number, number];
    readonly blank_pm_json: () => [number, number];
    readonly check_pm: (a: number, b: number) => [number, number];
    readonly hyphenation_patterns_needed: (a: number, b: number) => [number, number, number, number];
    readonly list_labels: (a: number, b: number) => [number, number, number, number];
    readonly model_to_pm: (a: number, b: number) => [number, number, number, number];
    readonly pm_to_model: (a: number, b: number) => [number, number, number, number];
    readonly pm_to_pdf: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pm_to_svg_pages: (a: number, b: number, c: number) => [number, number, number, number];
    readonly renderassets_addFont: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly renderassets_addImage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly renderassets_addPatterns: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly renderassets_aliasFont: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly renderassets_new: (a: number, b: number, c: number, d: number) => number;
    readonly schema_json: () => [number, number];
    readonly validate_model: (a: number, b: number) => [number, number, number, number];
    readonly version: () => [number, number];
    readonly word_count: (a: number, b: number) => [number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
