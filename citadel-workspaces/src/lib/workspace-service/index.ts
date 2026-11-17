/**
 * Workspace Service - Barrel Export
 *
 * Re-exports ALL public exports from the module for backward compatibility.
 * Consumers import from '@/lib/workspace-service' (resolves to this file).
 */

// Main service class
export { WorkspaceService } from './service';

// Singleton default export for backward compatibility
import { WorkspaceService } from './service';
const workspaceService: WorkspaceService = WorkspaceService.getInstance();
export default workspaceService;

// Expose for testing - allows protocol-level integration tests
if (typeof window !== 'undefined') {
  window.__workspaceService = workspaceService;
}
