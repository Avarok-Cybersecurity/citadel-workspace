/* tslint:disable */
/* eslint-disable */

export class Answer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The pixels or the JPEG, moved out (a second call answers empty).
     */
    take_data(): Uint8Array;
    /**
     * For a refusal, why, as a clause.
     */
    readonly detail: string;
    /**
     * `Fits`: the browser's own decoder may draw the file as it is. `Rgba`: every alpha is 255.
     */
    readonly flag: boolean;
    readonly height: number;
    readonly kind: AnswerKind;
    /**
     * EXIF orientation (1-8) to draw `Rgba` or `Jpeg` with.
     */
    readonly orientation: number;
    readonly width: number;
}

/**
 * What the answer is. The page's PhotoAnswerKind mirrors these numbers.
 */
export enum AnswerKind {
    Fits = 0,
    Rgba = 1,
    Jpeg = 2,
    TooLarge = 3,
    Unsupported = 4,
    Malformed = 5,
}

/**
 * Decodes `bytes` within `max_pixels` and `max_edge`; with `pixels` false, stops once the
 * picture is known to fit (a RAW's JPEG preview is still cut out: it costs no decode).
 */
export function decode_photo(bytes: Uint8Array, max_pixels: number, max_edge: number, pixels: boolean): Answer;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_answer_free: (a: number, b: number) => void;
    readonly answer_detail: (a: number, b: number) => void;
    readonly answer_flag: (a: number) => number;
    readonly answer_height: (a: number) => number;
    readonly answer_kind: (a: number) => number;
    readonly answer_orientation: (a: number) => number;
    readonly answer_take_data: (a: number, b: number) => void;
    readonly answer_width: (a: number) => number;
    readonly decode_photo: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
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
