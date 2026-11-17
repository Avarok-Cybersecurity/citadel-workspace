/**
 * Workspace Response Handler - Barrel Export
 *
 * Re-exports ALL public exports from the module for backward compatibility.
 * Consumers import from '@/lib/workspace-response-handler' (resolves to this file).
 */

// Service class
export { WorkspaceResponseHandler } from './service';

// Singleton instance
import { WorkspaceResponseHandler } from './service';
export const workspaceResponseHandler: WorkspaceResponseHandler = WorkspaceResponseHandler.getInstance();
