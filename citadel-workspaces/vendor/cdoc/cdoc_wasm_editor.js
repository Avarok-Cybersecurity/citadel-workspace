/* @ts-self-types="./cdoc_wasm_editor.d.ts" */

/**
 * Faces being gathered for editing.
 */
export class EditorFonts {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EditorFontsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_editorfonts_free(ptr, 0);
    }
    /**
     * Adds a face (TrueType or OpenType bytes).
     * @param {string} family
     * @param {boolean} bold
     * @param {boolean} italic
     * @param {Uint8Array} bytes
     */
    addFont(family, bold, italic, bytes) {
        const ptr0 = passStringToWasm0(family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.editorfonts_addFont(this.__wbg_ptr, ptr0, len0, bold, italic, ptr1, len1);
    }
    /**
     * Compiles a hyphenation pattern file by its manifest tag (`de-1996`); a language with no
     * file registered is not hyphenated.
     * @param {string} tag
     * @param {string} text
     */
    addPatterns(tag, text) {
        const ptr0 = passStringToWasm0(tag, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.editorfonts_addPatterns(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Serves `target` whenever a document asks for `name`.
     * @param {string} name
     * @param {string} target
     */
    aliasFont(name, target) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.editorfonts_aliasFont(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
     * No faces yet; `fallback_family` serves any family not added or aliased.
     * @param {string} fallback_family
     */
    constructor(fallback_family) {
        const ptr0 = passStringToWasm0(fallback_family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorfonts_new(ptr0, len0);
        this.__wbg_ptr = ret;
        EditorFontsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Seals the faces; they are kept for the page's life (seal once, reuse).
     * @returns {EditorSealedFonts}
     */
    seal() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.editorfonts_seal(ptr);
        return EditorSealedFonts.__wrap(ret);
    }
}
if (Symbol.dispose) EditorFonts.prototype[Symbol.dispose] = EditorFonts.prototype.free;

/**
 * An editing session over one document.
 */
export class EditorHandle {
    static __wrap(ptr) {
        const obj = Object.create(EditorHandle.prototype);
        obj.__wbg_ptr = ptr;
        EditorHandleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EditorHandleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_editorhandle_free(ptr, 0);
    }
    /**
     * Holds an image file of at most `max_bytes` bytes; returns the added-image record.
     * @param {Uint8Array} bytes
     * @param {number} max_bytes
     * @returns {Uint8Array}
     */
    addImage(bytes, max_bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_addImage(this.__wbg_ptr, ptr0, len0, max_bytes);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Applies a peer's update; returns the result record. Buffers at most `max_pending_ops`
     * waiting operations and `max_pending_bytes` bytes (no default; docs/edit-commands.md).
     * @param {Uint8Array} update
     * @param {number} max_pending_ops
     * @param {number} max_pending_bytes
     * @returns {Uint8Array}
     */
    applyRemote(update, max_pending_ops, max_pending_bytes) {
        const ptr0 = passArray8ToWasm0(update, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_applyRemote(this.__wbg_ptr, ptr0, len0, max_pending_ops, max_pending_bytes);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * This replica's awareness record.
     * @returns {Uint8Array}
     */
    awareness() {
        const ret = wasm.editorhandle_awareness(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * A new blank document as client `client` (a `BigInt`).
     * @param {bigint} client
     * @param {EditorSealedFonts} fonts
     * @returns {EditorHandle}
     */
    static blank(client, fonts) {
        _assertClass(fonts, EditorSealedFonts);
        const ret = wasm.editorhandle_blank(client, fonts.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return EditorHandle.__wrap(ret[0]);
    }
    /**
     * Adds to `images` every image this editor holds that its pages draw, for the PDF
     * artefact's `RenderAssets.addImage`.
     * @param {ImageStore} images
     */
    drawnImages(images) {
        _assertClass(images, ImageStore);
        wasm.editorhandle_drawnImages(this.__wbg_ptr, images.__wbg_ptr);
    }
    /**
     * What a peer at `sv` (a `stateVector()`, or `null` for a peer holding nothing, such as
     * an empty log) lacks, as updates of at most `max_bytes` each: the chunks record.
     * @param {Uint8Array | null | undefined} sv
     * @param {number} max_bytes
     * @returns {Uint8Array}
     */
    encodeDiffChunked(sv, max_bytes) {
        var ptr0 = isLikeNone(sv) ? 0 : passArray8ToWasm0(sv, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_encodeDiffChunked(this.__wbg_ptr, ptr0, len0, max_bytes);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * What a peer at state vector `sv` lacks.
     * @param {Uint8Array} sv
     * @returns {Uint8Array}
     */
    encodeDiff(sv) {
        const ptr0 = passArray8ToWasm0(sv, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_encodeDiff(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * The document as a file of `kind` (`docx`, `odt`, `md`, `txt` or `pdf`) with the loss
     * report; image bytes come from the images added here, then from `images`. Options JSON:
     * `{"kind": "document" | "template"}` for `docx` and `odt`, `{}` for `md` and `txt`,
     * `{"now": <RFC 3339>}` for `pdf`.
     * @param {string} kind
     * @param {string} options_json
     * @param {ImageStore} images
     * @returns {FileExport}
     */
    export(kind, options_json, images) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        _assertClass(images, ImageStore);
        const ret = wasm.editorhandle_export(this.__wbg_ptr, ptr0, len0, ptr1, len1, images.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return FileExport.__wrap(ret[0]);
    }
    /**
     * A new document from a file of `kind` (`docx`, `odt`, `md` or `txt`) as client
     * `client` (a `BigInt`); embedded images of at most `max_image_bytes` each are held by
     * their content ids. Options JSON: `{"limits": <ReadLimits>}` for `docx` and
     * `odt`, the `md_to_pm` and `txt_to_pm` options for `md` and `txt`.
     * @param {Uint8Array} bytes
     * @param {string} kind
     * @param {string} options_json
     * @param {bigint} client
     * @param {EditorSealedFonts} fonts
     * @param {number} max_image_bytes
     * @returns {ImportedEditor}
     */
    static fromDocument(bytes, kind, options_json, client, fonts, max_image_bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        _assertClass(fonts, EditorSealedFonts);
        const ret = wasm.editorhandle_fromDocument(ptr0, len0, ptr1, len1, ptr2, len2, client, fonts.__wbg_ptr, max_image_bytes);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ImportedEditor.__wrap(ret[0]);
    }
    /**
     * Collects the tombstones every peer in `known` (the known-peers record) has seen;
     * returns the collected record. Call it only when every listed peer is caught up.
     * @param {Uint8Array} known
     * @returns {Uint8Array}
     */
    gc(known) {
        const ptr0 = passArray8ToWasm0(known, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_gc(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * The position record nearest `(x, y)` on `page`.
     * @param {number} page
     * @param {number} x
     * @param {number} y
     * @returns {Uint8Array}
     */
    hitTest(page, x, y) {
        const ret = wasm.editorhandle_hitTest(this.__wbg_ptr, page, x, y);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The image record (`"CDB" 0x01 mime:str bytes:bytes`) of an image the editor holds, for
     * the canvas painter; an unknown id fails by name.
     * @param {string} content_id
     * @returns {Uint8Array}
     */
    image(content_id) {
        const ptr0 = passStringToWasm0(content_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_image(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * The list record of every image the editor holds (id, MIME type, size), for warming
     * a cache.
     * @returns {Uint8Array}
     */
    images() {
        const ret = wasm.editorhandle_images(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The document as model JSON, for an artefact that does not edit (the PDF artefact:
     * `model_to_pm`, then `pm_to_pdf`).
     * @returns {string}
     */
    modelJson() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.editorhandle_modelJson(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Opens a replica from a CRDT snapshot as client `client` (a `BigInt`).
     * @param {Uint8Array} snapshot
     * @param {bigint} client
     * @param {EditorSealedFonts} fonts
     * @returns {EditorHandle}
     */
    static open(snapshot, client, fonts) {
        const ptr0 = passArray8ToWasm0(snapshot, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(fonts, EditorSealedFonts);
        const ret = wasm.editorhandle_open(ptr0, len0, client, fonts.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return EditorHandle.__wrap(ret[0]);
    }
    /**
     * Pages in the document.
     * @returns {number}
     */
    pageCount() {
        const ret = wasm.editorhandle_pageCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Page `page`'s `[width, height]`, or nothing past the last page.
     * @param {number} page
     * @returns {Int32Array | undefined}
     */
    pageSize(page) {
        const ret = wasm.editorhandle_pageSize(this.__wbg_ptr, page);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        }
        return v1;
    }
    /**
     * The display list of `pages` (zero-based).
     * @param {Uint32Array} pages
     * @returns {Uint8Array}
     */
    paint(pages) {
        const ptr0 = passArray32ToWasm0(pages, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_paint(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * A peer's awareness record as a peer-view record.
     * @param {Uint8Array} record
     * @returns {Uint8Array}
     */
    peerView(record) {
        const ptr0 = passArray8ToWasm0(record, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_peerView(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Runs a request record; returns the result record.
     * @param {Uint8Array} request
     * @returns {Uint8Array}
     */
    request(request) {
        const ptr0 = passArray8ToWasm0(request, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.editorhandle_request(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * The selection's rectangles record (`"CDR" 0x01`) on `page`: for a page scrolled into
     * view, since results carry them for the viewport and the dirty pages only.
     * @param {number} page
     * @returns {Uint8Array}
     */
    selectionRects(page) {
        const ret = wasm.editorhandle_selectionRects(this.__wbg_ptr, page);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The selection's plain text, however long: what Copy puts on the clipboard when the
     * result record's text was past its cap.
     * @returns {string}
     */
    selectionText() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.editorhandle_selectionText(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * The full CRDT snapshot.
     * @returns {Uint8Array}
     */
    snapshot() {
        const ret = wasm.editorhandle_snapshot(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The replica's state vector.
     * @returns {Uint8Array}
     */
    stateVector() {
        const ret = wasm.editorhandle_stateVector(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The document's styles record: every style of the document with the properties it
     * resolves to, for the styles gallery.
     * @returns {Uint8Array}
     */
    styles() {
        const ret = wasm.editorhandle_styles(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) EditorHandle.prototype[Symbol.dispose] = EditorHandle.prototype.free;

/**
 * Faces sealed for the page's lifetime; open every editor on one of these.
 */
export class EditorSealedFonts {
    static __wrap(ptr) {
        const obj = Object.create(EditorSealedFonts.prototype);
        obj.__wbg_ptr = ptr;
        EditorSealedFontsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EditorSealedFontsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_editorsealedfonts_free(ptr, 0);
    }
}
if (Symbol.dispose) EditorSealedFonts.prototype[Symbol.dispose] = EditorSealedFonts.prototype.free;

/**
 * A written file (`.docx`, `.dotx`, `.odt`, `.ott`) and the report of what it could not carry.
 */
export class FileExport {
    static __wrap(ptr) {
        const obj = Object.create(FileExport.prototype);
        obj.__wbg_ptr = ptr;
        FileExportFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FileExportFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fileexport_free(ptr, 0);
    }
    /**
     * The file.
     * @returns {Uint8Array}
     */
    bytes() {
        const ret = wasm.fileexport_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The loss report as JSON.
     * @returns {string}
     */
    reportJson() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.fileexport_reportJson(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) FileExport.prototype[Symbol.dispose] = FileExport.prototype.free;

/**
 * Images moving across the boundary: embedded images found by `docx_to_pm` / `odt_to_pm`
 * (under provisional ids), and the bytes `pm_to_docx` / `pm_to_odt` need for the ids a
 * document names.
 */
export class ImageStore {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImageStoreFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_imagestore_free(ptr, 0);
    }
    /**
     * Add an image under a content id.
     * @param {string} id
     * @param {string} mime
     * @param {Uint8Array} bytes
     */
    add(id, mime, bytes) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(mime, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        wasm.imagestore_add(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
    }
    /**
     * The bytes of image `index`.
     * @param {number} index
     * @returns {Uint8Array | undefined}
     */
    bytes(index) {
        const ret = wasm.imagestore_bytes(this.__wbg_ptr, index);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * An empty store.
     */
    constructor() {
        const ret = wasm.imagestore_empty();
        this.__wbg_ptr = ret;
        ImageStoreFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * The content id of image `index`.
     * @param {number} index
     * @returns {string | undefined}
     */
    id(index) {
        const ret = wasm.imagestore_id(this.__wbg_ptr, index);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Whether the store holds no image.
     * @returns {boolean}
     */
    isEmpty() {
        const ret = wasm.imagestore_isEmpty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * How many images the store holds.
     * @returns {number}
     */
    len() {
        const ret = wasm.imagestore_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The MIME type of image `index`.
     * @param {number} index
     * @returns {string | undefined}
     */
    mime(index) {
        const ret = wasm.imagestore_mime(this.__wbg_ptr, index);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) ImageStore.prototype[Symbol.dispose] = ImageStore.prototype.free;

/**
 * A session opened on an imported file, and the import report.
 */
export class ImportedEditor {
    static __wrap(ptr) {
        const obj = Object.create(ImportedEditor.prototype);
        obj.__wbg_ptr = ptr;
        ImportedEditorFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImportedEditorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_importededitor_free(ptr, 0);
    }
    /**
     * The session; this object is spent.
     * @returns {EditorHandle}
     */
    editor() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.importededitor_editor(ptr);
        return EditorHandle.__wrap(ret);
    }
    /**
     * `{"report", "problems", "kind"}` as JSON.
     * @returns {string}
     */
    reportJson() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.importededitor_reportJson(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) ImportedEditor.prototype[Symbol.dispose] = ImportedEditor.prototype.free;

/**
 * A CRDT snapshot made from a stored document, and `{"report", "problems"}` as JSON.
 */
export class Migrated {
    static __wrap(ptr) {
        const obj = Object.create(Migrated.prototype);
        obj.__wbg_ptr = ptr;
        MigratedFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MigratedFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_migrated_free(ptr, 0);
    }
    /**
     * `{"report", "problems"}` as JSON.
     * @returns {string}
     */
    reportJson() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.migrated_reportJson(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The snapshot, to open with `EditorHandle`.
     * @returns {Uint8Array}
     */
    snapshot() {
        const ret = wasm.migrated_snapshot(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) Migrated.prototype[Symbol.dispose] = Migrated.prototype.free;

/**
 * Faces, images and the time a render uses, handed in from JavaScript.
 */
export class RenderAssets {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RenderAssetsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_renderassets_free(ptr, 0);
    }
    /**
     * Adds a face (TrueType or OpenType bytes).
     * @param {string} family
     * @param {boolean} bold
     * @param {boolean} italic
     * @param {Uint8Array} bytes
     */
    addFont(family, bold, italic, bytes) {
        const ptr0 = passStringToWasm0(family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.renderassets_addFont(this.__wbg_ptr, ptr0, len0, bold, italic, ptr1, len1);
    }
    /**
     * Adds an image under the content id documents refer to it by.
     * @param {string} content_id
     * @param {string} mime
     * @param {Uint8Array} bytes
     */
    addImage(content_id, mime, bytes) {
        const ptr0 = passStringToWasm0(content_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(mime, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        wasm.renderassets_addImage(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
    }
    /**
     * Compiles a hyphenation pattern file by its manifest tag (`de-1996`); a language with no
     * file registered is not hyphenated.
     * @param {string} tag
     * @param {string} text
     */
    addPatterns(tag, text) {
        const ptr0 = passStringToWasm0(tag, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.renderassets_addPatterns(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Serves `target` whenever a document asks for `name` (e.g. Calibri → Carlito).
     * @param {string} name
     * @param {string} target
     */
    aliasFont(name, target) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.renderassets_aliasFont(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
     * No faces or images yet. `fallback_family` serves any family not added or aliased;
     * `now_rfc3339` (e.g. `new Date().toISOString()`) is the time the PDF records.
     * @param {string} fallback_family
     * @param {string} now_rfc3339
     */
    constructor(fallback_family, now_rfc3339) {
        const ptr0 = passStringToWasm0(fallback_family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(now_rfc3339, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.renderassets_new(ptr0, len0, ptr1, len1);
        this.__wbg_ptr = ret;
        RenderAssetsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) RenderAssets.prototype[Symbol.dispose] = RenderAssets.prototype.free;

/**
 * A blank document as model JSON.
 * @returns {string}
 */
export function blank_model_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.blank_model_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * A blank document as ProseMirror JSON.
 * @returns {string}
 */
export function blank_pm_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.blank_pm_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Check a ProseMirror JSON tree against the schema; throws naming the first violation.
 * @param {string} pm_json
 */
export function check_pm(pm_json) {
    const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.check_pm(ptr0, len0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * A `.docx`, `.dotx`, `.docm` or `.dotm` to JSON `{"pm", "report", "problems", "kind"}`;
 * images go into `images`, macros are refused and reported. Options JSON:
 * `{"limits": <ReadLimits>}` (docs/edit-commands.md has values sized for a browser).
 * @param {Uint8Array} bytes
 * @param {ImageStore} images
 * @param {string} options_json
 * @returns {string}
 */
export function docx_to_pm(bytes, images, options_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(images, ImageStore);
        const ptr1 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.docx_to_pm(ptr0, len0, images.__wbg_ptr, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * That face's metrics as the 8-byte record (`unitsPerEm`, ascender, descender, line gap).
 * @param {RenderAssets} assets
 * @param {string} family
 * @param {boolean} bold
 * @param {boolean} italic
 * @returns {Uint8Array}
 */
export function face_metrics(assets, family, bold, italic) {
    _assertClass(assets, RenderAssets);
    const ptr0 = passStringToWasm0(family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.face_metrics(assets.__wbg_ptr, ptr0, len0, bold, italic);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * The outline of glyph `glyph_id` in the face a display list's face table names, as a
 * glyph-path record (font units, y up).
 * @param {RenderAssets} assets
 * @param {string} family
 * @param {boolean} bold
 * @param {boolean} italic
 * @param {number} glyph_id
 * @returns {Uint8Array}
 */
export function glyph_path(assets, family, bold, italic, glyph_id) {
    _assertClass(assets, RenderAssets);
    const ptr0 = passStringToWasm0(family, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.glyph_path(assets.__wbg_ptr, ptr0, len0, bold, italic, glyph_id);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * The manifest tags (`crates/cdoc-para/patterns/manifest.json`) of the hyphenation pattern
 * files a model document needs, as a JSON array: register these before laying it out.
 * @param {string} model_json
 * @returns {string}
 */
export function hyphenation_patterns_needed(model_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(model_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hyphenation_patterns_needed(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * The list label of every paragraph, in ProseMirror paragraph order, as a JSON array of
 * strings and nulls.
 * @param {string} pm_json
 * @returns {string}
 */
export function list_labels(pm_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.list_labels(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Markdown to JSON `{"pm", "report", "problems"}`. Options JSON:
 * `{"textWidth", "imageWidth", "imageHeight"}` in hundredths of a point.
 * @param {string} md
 * @param {string} options_json
 * @returns {string}
 */
export function md_to_pm(md, options_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(md, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.md_to_pm(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Model JSON → ProseMirror JSON.
 * @param {string} model_json
 * @returns {string}
 */
export function model_to_pm(model_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(model_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.model_to_pm(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * A `.odt` or `.ott` to JSON `{"pm", "report", "problems", "kind"}`; images go into
 * `images`. Options JSON: `{"limits": <ReadLimits>}`.
 * @param {Uint8Array} bytes
 * @param {ImageStore} images
 * @param {string} options_json
 * @returns {string}
 */
export function odt_to_pm(bytes, images, options_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(images, ImageStore);
        const ptr1 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.odt_to_pm(ptr0, len0, images.__wbg_ptr, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * ProseMirror JSON to a CRDT snapshot written as `client`, for moving a stored document onto
 * collaborative editing; the report JSON is `{"report", "problems"}`.
 * @param {string} pm_json
 * @param {bigint} client
 * @returns {Migrated}
 */
export function pm_to_crdt_snapshot(pm_json, client) {
    const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pm_to_crdt_snapshot(ptr0, len0, client);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Migrated.__wrap(ret[0]);
}

/**
 * ProseMirror JSON → the display list of every page: the binary format of
 * `docs/display-list.md`, returned as a `Uint8Array` the caller can transfer to the painter.
 * @param {string} pm_json
 * @param {RenderAssets} assets
 * @returns {Uint8Array}
 */
export function pm_to_display_list(pm_json, assets) {
    const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(assets, RenderAssets);
    const ret = wasm.pm_to_display_list(ptr0, len0, assets.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * ProseMirror JSON → a display list of only `pages` (zero-based), for repainting the pages
 * an edit changed.
 * @param {string} pm_json
 * @param {RenderAssets} assets
 * @param {Uint32Array} pages
 * @returns {Uint8Array}
 */
export function pm_to_display_list_pages(pm_json, assets, pages) {
    const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(assets, RenderAssets);
    const ptr1 = passArray32ToWasm0(pages, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.pm_to_display_list_pages(ptr0, len0, assets.__wbg_ptr, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * ProseMirror JSON to a `.docx` or `.dotx`; image bytes come from `images`. Options JSON:
 * `{"kind": "document" | "template"}`.
 * @param {string} pm_json
 * @param {ImageStore} images
 * @param {string} options_json
 * @returns {FileExport}
 */
export function pm_to_docx(pm_json, images, options_json) {
    const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(images, ImageStore);
    const ptr1 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.pm_to_docx(ptr0, len0, images.__wbg_ptr, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return FileExport.__wrap(ret[0]);
}

/**
 * ProseMirror JSON to JSON `{"text", "report"}` holding Markdown.
 * @param {string} pm_json
 * @returns {string}
 */
export function pm_to_md(pm_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.pm_to_md(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * ProseMirror JSON → model JSON.
 * @param {string} pm_json
 * @returns {string}
 */
export function pm_to_model(pm_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.pm_to_model(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * ProseMirror JSON to a `.odt` or `.ott`; image bytes come from `images`. Options JSON:
 * `{"kind": "document" | "template"}`.
 * @param {string} pm_json
 * @param {ImageStore} images
 * @param {string} options_json
 * @returns {FileExport}
 */
export function pm_to_odt(pm_json, images, options_json) {
    const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(images, ImageStore);
    const ptr1 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.pm_to_odt(ptr0, len0, images.__wbg_ptr, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return FileExport.__wrap(ret[0]);
}

/**
 * ProseMirror JSON to JSON `{"text", "report"}` holding plain text.
 * @param {string} pm_json
 * @returns {string}
 */
export function pm_to_txt(pm_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(pm_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.pm_to_txt(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * The ProseMirror schema as JSON.
 * @returns {string}
 */
export function schema_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.schema_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * The old chat editor's TipTap `StarterKit` JSON to a CRDT snapshot written as `client`, for
 * moving a chat document onto the canvas; the report JSON is `{"report", "problems"}` and names
 * what the model could not hold (`docs/tiptap-schema.md`).
 * @param {string} json
 * @param {bigint} client
 * @returns {Migrated}
 */
export function tiptap_to_crdt_snapshot(json, client) {
    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.tiptap_to_crdt_snapshot(ptr0, len0, client);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Migrated.__wrap(ret[0]);
}

/**
 * The old chat editor's TipTap `StarterKit` JSON as ProseMirror JSON in this schema (the
 * document `tiptap_to_crdt_snapshot` writes), to show the original read-only.
 * @param {string} json
 * @returns {string}
 */
export function tiptap_to_pm(json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tiptap_to_pm(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Plain text to JSON `{"pm", "report", "problems"}`. Options JSON:
 * `{"singleNewline": "break" | "space"}`.
 * @param {string} text
 * @param {string} options_json
 * @returns {string}
 */
export function txt_to_pm(text, options_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.txt_to_pm(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Validate a model document; returns a JSON array of error messages, empty when valid.
 * @param {string} model_json
 * @returns {string}
 */
export function validate_model(model_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(model_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.validate_model(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * The crate version, so the UI can log which build it loaded.
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Words in the body of a model document.
 * @param {string} model_json
 * @returns {number}
 */
export function word_count(model_json) {
    const ptr0 = passStringToWasm0(model_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.word_count(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./cdoc_wasm_editor_bg.js": import0,
    };
}

const EditorFontsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_editorfonts_free(ptr, 1));
const EditorHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_editorhandle_free(ptr, 1));
const EditorSealedFontsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_editorsealedfonts_free(ptr, 1));
const FileExportFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fileexport_free(ptr, 1));
const ImageStoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_imagestore_free(ptr, 1));
const ImportedEditorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_importededitor_free(ptr, 1));
const MigratedFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_migrated_free(ptr, 1));
const RenderAssetsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_renderassets_free(ptr, 1));

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = "/cdoc/cdoc_wasm_editor_bg.wasm";
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
