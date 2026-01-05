/* tslint:disable */
/* eslint-disable */

export function close_connection(): Promise<void>;

/**
 * Ensures a messenger handle is open for the given CID.
 * Returns true if the messenger was just opened, false if already open or being opened by another task.
 * Use this for polling to maintain messenger handles across leader/follower tab transitions.
 */
export function ensure_messenger_open(cid_str: string): Promise<boolean>;

export function get_version(): string;

export function init(ws_url: string): Promise<void>;

export function is_initialized(): boolean;

export function main(): void;

export function next_message(): Promise<any>;

/**
 * Opens a messenger handle for the given CID.
 * This creates an ISM (InterSession Messaging) channel for reliable-ordered messaging.
 * Must be called once at login and maintained via polling (see ensure_messenger_open).
 */
export function open_messenger_for(cid_str: string): Promise<void>;

export function restart(ws_url: string): Promise<void>;

export function send_direct_to_internal_service(message: any): Promise<void>;

/**
 * Sends a P2P message using ISM-routed reliable messaging.
 * Unlike send_p2p_message which bypasses ISM, this function uses
 * send_message_to_with_security_level for guaranteed delivery.
 */
export function send_p2p_message_reliable(local_cid_str: string, peer_cid_str: string, message: Uint8Array, security_level?: string | null): Promise<void>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly close_connection: () => any;
  readonly ensure_messenger_open: (a: number, b: number) => any;
  readonly get_version: () => [number, number];
  readonly init: (a: number, b: number) => any;
  readonly is_initialized: () => number;
  readonly main: () => void;
  readonly next_message: () => any;
  readonly open_messenger_for: (a: number, b: number) => any;
  readonly restart: (a: number, b: number) => any;
  readonly send_direct_to_internal_service: (a: any) => any;
  readonly send_p2p_message_reliable: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
  readonly wasm_bindgen__convert__closures_____invoke__h499a1a399d04b2d4: (a: number, b: number) => void;
  readonly wasm_bindgen__closure__destroy__hecd26b559a7213df: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hf12eded22b407bd2: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h0935c9f7bb79e343: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__ha92af1ff1c33058a: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__hcdca100ee600d3da: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hf6217e1fee95fc6b: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h97da8f3c9841ad63: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h0bc8e716d0049947: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
