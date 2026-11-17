/**
 * Workspace Service - Type Helpers
 *
 * Adapter functions for converting TypeScript protocol types
 * to WASM-compatible types.
 */

import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';

/**
 * Adapts a locally-constructed WorkspaceProtocolRequestTS to the WASM-generated
 * WorkspaceProtocolRequest type. The cast is needed because our TypeScript-side
 * request type (WorkspaceProtocolRequestTS) is structurally compatible at runtime
 * but TypeScript cannot verify compatibility with the WASM code-generated type.
 */
export function toWasmWorkspaceRequest(request: WorkspaceProtocolRequestTS): WorkspaceProtocolRequest {
  return request as unknown as WorkspaceProtocolRequest;
}
