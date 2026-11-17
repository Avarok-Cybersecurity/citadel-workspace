/* tslint:disable */
/* eslint-disable */
export function get_version(): string;
export function close_connection(): Promise<void>;
export function main(): void;
export function is_initialized(): boolean;
/**
 * Sends a P2P message using ISM-routed reliable messaging.
 * Unlike send_p2p_message which bypasses ISM, this function uses
 * send_message_to_with_security_level for guaranteed delivery.
 */
export function send_p2p_message_reliable(local_cid_str: string, peer_cid_str: string, message: Uint8Array, security_level?: string | null): Promise<void>;
export function init(ws_url: string): Promise<void>;
export function next_message(): Promise<any>;
export function send_direct_to_internal_service(message: any): Promise<void>;
export function restart(ws_url: string): Promise<void>;
export function open_p2p_connection(cid_str: string): Promise<void>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly close_connection: () => any;
  readonly get_version: () => [number, number];
  readonly init: (a: number, b: number) => any;
  readonly is_initialized: () => number;
  readonly main: () => void;
  readonly next_message: () => any;
  readonly open_p2p_connection: (a: number, b: number) => any;
  readonly restart: (a: number, b: number) => any;
  readonly send_direct_to_internal_service: (a: any) => any;
  readonly send_p2p_message_reliable: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_6: WebAssembly.Table;
  readonly closure405_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure281_externref_shim: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hffef68bb67144b57: (a: number, b: number) => void;
  readonly closure473_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure498_externref_shim: (a: number, b: number, c: any, d: any) => void;
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
