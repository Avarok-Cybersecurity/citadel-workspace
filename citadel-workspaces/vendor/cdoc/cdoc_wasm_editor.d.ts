/* tslint:disable */
/* eslint-disable */

/**
 * Faces being gathered for editing.
 */
export class EditorFonts {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds a face (TrueType or OpenType bytes).
     */
    addFont(family: string, bold: boolean, italic: boolean, bytes: Uint8Array): void;
    /**
     * Compiles a hyphenation pattern file by its manifest tag (`de-1996`); a language with no
     * file registered is not hyphenated.
     */
    addPatterns(tag: string, text: string): void;
    /**
     * Serves `target` whenever a document asks for `name`.
     */
    aliasFont(name: string, target: string): void;
    /**
     * No faces yet; `fallback_family` serves any family not added or aliased.
     */
    constructor(fallback_family: string);
    /**
     * Seals the faces; they are kept for the page's life (seal once, reuse).
     */
    seal(): EditorSealedFonts;
}

/**
 * An editing session over one document.
 */
export class EditorHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Holds an image file of at most `max_bytes` bytes; returns the added-image record.
     */
    addImage(bytes: Uint8Array, max_bytes: number): Uint8Array;
    /**
     * Applies a peer's update; returns the result record. Buffers at most `max_pending_ops`
     * waiting operations and `max_pending_bytes` bytes (no default; docs/edit-commands.md).
     */
    applyRemote(update: Uint8Array, max_pending_ops: number, max_pending_bytes: number): Uint8Array;
    /**
     * This replica's awareness record.
     */
    awareness(): Uint8Array;
    /**
     * A new blank document as client `client` (a `BigInt`).
     */
    static blank(client: bigint, fonts: EditorSealedFonts): EditorHandle;
    /**
     * Adds to `images` every image this editor holds that its pages draw, for the PDF
     * artefact's `RenderAssets.addImage`.
     */
    drawnImages(images: ImageStore): void;
    /**
     * What a peer at `sv` (a `stateVector()`, or `null` for a peer holding nothing, such as
     * an empty log) lacks, as updates of at most `max_bytes` each: the chunks record.
     */
    encodeDiffChunked(sv: Uint8Array | null | undefined, max_bytes: number): Uint8Array;
    /**
     * What a peer at state vector `sv` lacks.
     */
    encodeDiff(sv: Uint8Array): Uint8Array;
    /**
     * The document as a file of `kind` (`docx`, `odt`, `md`, `txt` or `pdf`) with the loss
     * report; image bytes come from the images added here, then from `images`. Options JSON:
     * `{"kind": "document" | "template"}` for `docx` and `odt`, `{}` for `md` and `txt`,
     * `{"now": <RFC 3339>}` for `pdf`.
     */
    export(kind: string, options_json: string, images: ImageStore): FileExport;
    /**
     * A new document from a file of `kind` (`docx`, `odt`, `md` or `txt`) as client
     * `client` (a `BigInt`); embedded images of at most `max_image_bytes` each are held by
     * their content ids. Options JSON: `{"limits": <ReadLimits>}` for `docx` and
     * `odt`, the `md_to_pm` and `txt_to_pm` options for `md` and `txt`.
     */
    static fromDocument(bytes: Uint8Array, kind: string, options_json: string, client: bigint, fonts: EditorSealedFonts, max_image_bytes: number): ImportedEditor;
    /**
     * Collects the tombstones every peer in `known` (the known-peers record) has seen;
     * returns the collected record. Call it only when every listed peer is caught up.
     */
    gc(known: Uint8Array): Uint8Array;
    /**
     * The position record nearest `(x, y)` on `page`.
     */
    hitTest(page: number, x: number, y: number): Uint8Array;
    /**
     * The image record (`"CDB" 0x01 mime:str bytes:bytes`) of an image the editor holds, for
     * the canvas painter; an unknown id fails by name.
     */
    image(content_id: string): Uint8Array;
    /**
     * The list record of every image the editor holds (id, MIME type, size), for warming
     * a cache.
     */
    images(): Uint8Array;
    /**
     * The document as model JSON, for an artefact that does not edit (the PDF artefact:
     * `model_to_pm`, then `pm_to_pdf`).
     */
    modelJson(): string;
    /**
     * Opens a replica from a CRDT snapshot as client `client` (a `BigInt`).
     */
    static open(snapshot: Uint8Array, client: bigint, fonts: EditorSealedFonts): EditorHandle;
    /**
     * Pages in the document.
     */
    pageCount(): number;
    /**
     * Page `page`'s `[width, height]`, or nothing past the last page.
     */
    pageSize(page: number): Int32Array | undefined;
    /**
     * The display list of `pages` (zero-based).
     */
    paint(pages: Uint32Array): Uint8Array;
    /**
     * A peer's awareness record as a peer-view record.
     */
    peerView(record: Uint8Array): Uint8Array;
    /**
     * Runs a request record; returns the result record.
     */
    request(request: Uint8Array): Uint8Array;
    /**
     * The selection's rectangles record (`"CDR" 0x01`) on `page`: for a page scrolled into
     * view, since results carry them for the viewport and the dirty pages only.
     */
    selectionRects(page: number): Uint8Array;
    /**
     * The selection's plain text, however long: what Copy puts on the clipboard when the
     * result record's text was past its cap.
     */
    selectionText(): string;
    /**
     * The full CRDT snapshot.
     */
    snapshot(): Uint8Array;
    /**
     * The replica's state vector.
     */
    stateVector(): Uint8Array;
    /**
     * The document's styles record: every style of the document with the properties it
     * resolves to, for the styles gallery.
     */
    styles(): Uint8Array;
}

/**
 * Faces sealed for the page's lifetime; open every editor on one of these.
 */
export class EditorSealedFonts {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

/**
 * A written file (`.docx`, `.dotx`, `.odt`, `.ott`) and the report of what it could not carry.
 */
export class FileExport {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The file.
     */
    bytes(): Uint8Array;
    /**
     * The loss report as JSON.
     */
    reportJson(): string;
}

/**
 * Images moving across the boundary: embedded images found by `docx_to_pm` / `odt_to_pm`
 * (under provisional ids), and the bytes `pm_to_docx` / `pm_to_odt` need for the ids a
 * document names.
 */
export class ImageStore {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add an image under a content id.
     */
    add(id: string, mime: string, bytes: Uint8Array): void;
    /**
     * The bytes of image `index`.
     */
    bytes(index: number): Uint8Array | undefined;
    /**
     * An empty store.
     */
    constructor();
    /**
     * The content id of image `index`.
     */
    id(index: number): string | undefined;
    /**
     * Whether the store holds no image.
     */
    isEmpty(): boolean;
    /**
     * How many images the store holds.
     */
    len(): number;
    /**
     * The MIME type of image `index`.
     */
    mime(index: number): string | undefined;
}

/**
 * A session opened on an imported file, and the import report.
 */
export class ImportedEditor {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The session; this object is spent.
     */
    editor(): EditorHandle;
    /**
     * `{"report", "problems", "kind"}` as JSON.
     */
    reportJson(): string;
}

/**
 * A CRDT snapshot made from a stored document, and `{"report", "problems"}` as JSON.
 */
export class Migrated {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `{"report", "problems"}` as JSON.
     */
    reportJson(): string;
    /**
     * The snapshot, to open with `EditorHandle`.
     */
    snapshot(): Uint8Array;
}

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
 * A `.docx`, `.dotx`, `.docm` or `.dotm` to JSON `{"pm", "report", "problems", "kind"}`;
 * images go into `images`, macros are refused and reported. Options JSON:
 * `{"limits": <ReadLimits>}` (docs/edit-commands.md has values sized for a browser).
 */
export function docx_to_pm(bytes: Uint8Array, images: ImageStore, options_json: string): string;

/**
 * That face's metrics as the 8-byte record (`unitsPerEm`, ascender, descender, line gap).
 */
export function face_metrics(assets: RenderAssets, family: string, bold: boolean, italic: boolean): Uint8Array;

/**
 * The outline of glyph `glyph_id` in the face a display list's face table names, as a
 * glyph-path record (font units, y up).
 */
export function glyph_path(assets: RenderAssets, family: string, bold: boolean, italic: boolean, glyph_id: number): Uint8Array;

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
 * Markdown to JSON `{"pm", "report", "problems"}`. Options JSON:
 * `{"textWidth", "imageWidth", "imageHeight"}` in hundredths of a point.
 */
export function md_to_pm(md: string, options_json: string): string;

/**
 * Model JSON → ProseMirror JSON.
 */
export function model_to_pm(model_json: string): string;

/**
 * A `.odt` or `.ott` to JSON `{"pm", "report", "problems", "kind"}`; images go into
 * `images`. Options JSON: `{"limits": <ReadLimits>}`.
 */
export function odt_to_pm(bytes: Uint8Array, images: ImageStore, options_json: string): string;

/**
 * ProseMirror JSON to a CRDT snapshot written as `client`, for moving a stored document onto
 * collaborative editing; the report JSON is `{"report", "problems"}`.
 */
export function pm_to_crdt_snapshot(pm_json: string, client: bigint): Migrated;

/**
 * ProseMirror JSON → the display list of every page: the binary format of
 * `docs/display-list.md`, returned as a `Uint8Array` the caller can transfer to the painter.
 */
export function pm_to_display_list(pm_json: string, assets: RenderAssets): Uint8Array;

/**
 * ProseMirror JSON → a display list of only `pages` (zero-based), for repainting the pages
 * an edit changed.
 */
export function pm_to_display_list_pages(pm_json: string, assets: RenderAssets, pages: Uint32Array): Uint8Array;

/**
 * ProseMirror JSON to a `.docx` or `.dotx`; image bytes come from `images`. Options JSON:
 * `{"kind": "document" | "template"}`.
 */
export function pm_to_docx(pm_json: string, images: ImageStore, options_json: string): FileExport;

/**
 * ProseMirror JSON to JSON `{"text", "report"}` holding Markdown.
 */
export function pm_to_md(pm_json: string): string;

/**
 * ProseMirror JSON → model JSON.
 */
export function pm_to_model(pm_json: string): string;

/**
 * ProseMirror JSON to a `.odt` or `.ott`; image bytes come from `images`. Options JSON:
 * `{"kind": "document" | "template"}`.
 */
export function pm_to_odt(pm_json: string, images: ImageStore, options_json: string): FileExport;

/**
 * ProseMirror JSON to JSON `{"text", "report"}` holding plain text.
 */
export function pm_to_txt(pm_json: string): string;

/**
 * The ProseMirror schema as JSON.
 */
export function schema_json(): string;

/**
 * The old chat editor's TipTap `StarterKit` JSON to a CRDT snapshot written as `client`, for
 * moving a chat document onto the canvas; the report JSON is `{"report", "problems"}` and names
 * what the model could not hold (`docs/tiptap-schema.md`).
 */
export function tiptap_to_crdt_snapshot(json: string, client: bigint): Migrated;

/**
 * The old chat editor's TipTap `StarterKit` JSON as ProseMirror JSON in this schema (the
 * document `tiptap_to_crdt_snapshot` writes), to show the original read-only.
 */
export function tiptap_to_pm(json: string): string;

/**
 * Plain text to JSON `{"pm", "report", "problems"}`. Options JSON:
 * `{"singleNewline": "break" | "space"}`.
 */
export function txt_to_pm(text: string, options_json: string): string;

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
    readonly __wbg_editorfonts_free: (a: number, b: number) => void;
    readonly __wbg_editorhandle_free: (a: number, b: number) => void;
    readonly __wbg_editorsealedfonts_free: (a: number, b: number) => void;
    readonly __wbg_fileexport_free: (a: number, b: number) => void;
    readonly __wbg_imagestore_free: (a: number, b: number) => void;
    readonly __wbg_importededitor_free: (a: number, b: number) => void;
    readonly __wbg_migrated_free: (a: number, b: number) => void;
    readonly __wbg_renderassets_free: (a: number, b: number) => void;
    readonly blank_model_json: () => [number, number];
    readonly blank_pm_json: () => [number, number];
    readonly check_pm: (a: number, b: number) => [number, number];
    readonly docx_to_pm: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly editorfonts_addFont: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly editorfonts_addPatterns: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly editorfonts_aliasFont: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly editorfonts_new: (a: number, b: number) => number;
    readonly editorfonts_seal: (a: number) => number;
    readonly editorhandle_addImage: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly editorhandle_applyRemote: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly editorhandle_awareness: (a: number) => [number, number];
    readonly editorhandle_blank: (a: bigint, b: number) => [number, number, number];
    readonly editorhandle_drawnImages: (a: number, b: number) => void;
    readonly editorhandle_encodeDiff: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorhandle_encodeDiffChunked: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly editorhandle_export: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly editorhandle_fromDocument: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint, h: number, i: number) => [number, number, number];
    readonly editorhandle_gc: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorhandle_hitTest: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly editorhandle_image: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorhandle_images: (a: number) => [number, number];
    readonly editorhandle_modelJson: (a: number) => [number, number];
    readonly editorhandle_open: (a: number, b: number, c: bigint, d: number) => [number, number, number];
    readonly editorhandle_pageCount: (a: number) => number;
    readonly editorhandle_pageSize: (a: number, b: number) => [number, number];
    readonly editorhandle_paint: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorhandle_peerView: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorhandle_request: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorhandle_selectionRects: (a: number, b: number) => [number, number, number, number];
    readonly editorhandle_selectionText: (a: number) => [number, number, number, number];
    readonly editorhandle_snapshot: (a: number) => [number, number];
    readonly editorhandle_stateVector: (a: number) => [number, number];
    readonly editorhandle_styles: (a: number) => [number, number, number, number];
    readonly face_metrics: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly fileexport_bytes: (a: number) => [number, number];
    readonly fileexport_reportJson: (a: number) => [number, number];
    readonly glyph_path: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly hyphenation_patterns_needed: (a: number, b: number) => [number, number, number, number];
    readonly imagestore_add: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly imagestore_bytes: (a: number, b: number) => [number, number];
    readonly imagestore_empty: () => number;
    readonly imagestore_id: (a: number, b: number) => [number, number];
    readonly imagestore_isEmpty: (a: number) => number;
    readonly imagestore_len: (a: number) => number;
    readonly imagestore_mime: (a: number, b: number) => [number, number];
    readonly importededitor_editor: (a: number) => number;
    readonly importededitor_reportJson: (a: number) => [number, number];
    readonly list_labels: (a: number, b: number) => [number, number, number, number];
    readonly md_to_pm: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly migrated_reportJson: (a: number) => [number, number];
    readonly migrated_snapshot: (a: number) => [number, number];
    readonly model_to_pm: (a: number, b: number) => [number, number, number, number];
    readonly odt_to_pm: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly pm_to_crdt_snapshot: (a: number, b: number, c: bigint) => [number, number, number];
    readonly pm_to_display_list: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pm_to_display_list_pages: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly pm_to_docx: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly pm_to_md: (a: number, b: number) => [number, number, number, number];
    readonly pm_to_model: (a: number, b: number) => [number, number, number, number];
    readonly pm_to_odt: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly pm_to_txt: (a: number, b: number) => [number, number, number, number];
    readonly renderassets_addFont: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly renderassets_addImage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly renderassets_addPatterns: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly renderassets_aliasFont: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly renderassets_new: (a: number, b: number, c: number, d: number) => number;
    readonly schema_json: () => [number, number];
    readonly tiptap_to_crdt_snapshot: (a: number, b: number, c: bigint) => [number, number, number];
    readonly tiptap_to_pm: (a: number, b: number) => [number, number, number, number];
    readonly txt_to_pm: (a: number, b: number, c: number, d: number) => [number, number, number, number];
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
