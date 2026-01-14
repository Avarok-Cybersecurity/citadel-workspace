// Re-export the WASM client
export { InternalServiceWasmClient } from 'citadel-internal-service-wasm-client';
export type { WasmClientConfig } from 'citadel-internal-service-wasm-client';

// Export all types from citadel-internal-service-wasm-client
export * from 'citadel-internal-service-wasm-client';

// Export workspace-specific types
export * from './types/workspace-types';

// Export workspace client wrapper
export { WorkspaceClient } from './WorkspaceClient';
export type { WorkspaceClientConfig } from './WorkspaceClient';

// Export auth module
export { WorkspaceAuth } from './auth';
export type { AuthSession } from './auth';

// Export session management
export { WorkspaceSessionManager } from './session';
export type { SessionConfig, WorkspaceSessionInfo } from './session';