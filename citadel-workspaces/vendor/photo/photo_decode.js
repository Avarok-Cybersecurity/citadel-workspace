/* @ts-self-types="./photo_decode.d.ts" */

export class Answer {
    static __wrap(ptr) {
        const obj = Object.create(Answer.prototype);
        obj.__wbg_ptr = ptr;
        AnswerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AnswerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_answer_free(ptr, 0);
    }
    /**
     * For a refusal, why, as a clause.
     * @returns {string}
     */
    get detail() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.answer_detail(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `Fits`: the browser's own decoder may draw the file as it is. `Rgba`: every alpha is 255.
     * @returns {boolean}
     */
    get flag() {
        const ret = wasm.answer_flag(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get height() {
        const ret = wasm.answer_height(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {AnswerKind}
     */
    get kind() {
        const ret = wasm.answer_kind(this.__wbg_ptr);
        return ret;
    }
    /**
     * EXIF orientation (1-8) to draw `Rgba` or `Jpeg` with.
     * @returns {number}
     */
    get orientation() {
        const ret = wasm.answer_orientation(this.__wbg_ptr);
        return ret;
    }
    /**
     * The pixels or the JPEG, moved out (a second call answers empty).
     * @returns {Uint8Array}
     */
    take_data() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.answer_take_data(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.answer_width(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) Answer.prototype[Symbol.dispose] = Answer.prototype.free;

/**
 * What the answer is. The page's PhotoAnswerKind mirrors these numbers.
 * @enum {0 | 1 | 2 | 3 | 4 | 5}
 */
export const AnswerKind = Object.freeze({
    Fits: 0, "0": "Fits",
    Rgba: 1, "1": "Rgba",
    Jpeg: 2, "2": "Jpeg",
    TooLarge: 3, "3": "TooLarge",
    Unsupported: 4, "4": "Unsupported",
    Malformed: 5, "5": "Malformed",
});

/**
 * Decodes `bytes` within `max_pixels` and `max_edge`; with `pixels` false, stops once the
 * picture is known to fit (a RAW's JPEG preview is still cut out: it costs no decode).
 * @param {Uint8Array} bytes
 * @param {number} max_pixels
 * @param {number} max_edge
 * @param {boolean} pixels
 * @returns {Answer}
 */
export function decode_photo(bytes, max_pixels, max_edge, pixels) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decode_photo(ptr0, len0, max_pixels, max_edge, pixels);
    return Answer.__wrap(ret);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
    };
    return {
        __proto__: null,
        "./photo_decode_bg.js": import0,
    };
}

const AnswerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_answer_free(ptr, 1));

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
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

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
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
        module_or_path = "/photo/photo_decode_bg.wasm";
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
