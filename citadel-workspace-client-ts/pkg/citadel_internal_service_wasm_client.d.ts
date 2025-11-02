/* tslint:disable */
/* eslint-disable */
export function main(): void;
export function init(ws_url: string): Promise<void>;
export function restart(ws_url: string): Promise<void>;
export function open_p2p_connection(cid_str: string): Promise<void>;
export function next_message(): Promise<any>;
export function send_p2p_message(cid_str: string, message: any): Promise<void>;
export function send_direct_to_internal_service(message: any): Promise<void>;
export function close_connection(): Promise<void>;
export function get_version(): string;
export function is_initialized(): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly main: () => void;
  readonly init: (a: number, b: number) => any;
  readonly restart: (a: number, b: number) => any;
  readonly open_p2p_connection: (a: number, b: number) => any;
  readonly next_message: () => any;
  readonly send_p2p_message: (a: number, b: number, c: any) => any;
  readonly send_direct_to_internal_service: (a: any) => any;
  readonly close_connection: () => any;
  readonly get_version: () => [number, number];
  readonly is_initialized: () => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_6: WebAssembly.Table;
  readonly closure458_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure238_externref_shim: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__convert__closures_____invoke__he63042c0eed4bb5e: (a: number, b: number) => void;
  readonly closure393_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure474_externref_shim: (a: number, b: number, c: any, d: any) => void;
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
