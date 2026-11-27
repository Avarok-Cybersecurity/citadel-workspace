// Re-export the WASM client
export { InternalServiceWasmClient } from 'citadel-internal-service-wasm-client';
export type { WasmClientConfig } from 'citadel-internal-service-wasm-client';

// Export all types from citadel-internal-service-wasm-client
export * from 'citadel-internal-service-wasm-client';

// Export workspace-specific types
export * from './types/workspace-types.js';

// Export workspace client wrapper
export { WorkspaceClient } from './WorkspaceClient.js';
export type { WorkspaceClientConfig } from './WorkspaceClient.js';

// The workspace protocol codec (Rust, over citadel-workspace-types): every path that reads or
// writes workspace protocol bytes uses it, so a payload is checked and u64 fields are exact.
export {
  decodeWorkspacePayload,
  encodeWorkspacePayload,
  loadWorkspaceCodec,
  loadWorkspaceCodecFrom,
  WORKSPACE_CODEC_WASM_URL,
} from './workspace-codec.js';

// Export auth module
export { WorkspaceAuth } from './auth.js';
export type { AuthSession } from './auth.js';

// Export session management
export { WorkspaceSessionManager } from './session.js';
export type { SessionConfig, WorkspaceSessionInfo } from './session.js';

// Note: isVariant, isResponseType, isRequestType, DiscriminatorOf, ResponseType, RequestType
// are re-exported via `export * from 'citadel-internal-service-wasm-client'` above.