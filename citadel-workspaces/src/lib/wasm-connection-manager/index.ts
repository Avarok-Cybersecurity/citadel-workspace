/**
 * WASM Connection Manager Module
 *
 * Re-exports all public API for the WASM connection manager.
 */

export type { SessionState } from './types';
export {
  POLL_INTERVAL_VISIBLE_MS,
  POLL_INTERVAL_HIDDEN_MS,
  MAX_CONSECUTIVE_FAILURES,
} from './types';

export { WasmConnectionManager, wasmConnectionManager } from './manager';
