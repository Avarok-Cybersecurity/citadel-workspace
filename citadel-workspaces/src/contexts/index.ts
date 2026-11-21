/**
 * Contexts Barrel Export
 *
 * Centralized exports for all React contexts.
 */

export { PermissionsProvider, usePermissions, PERMISSION_LABELS, PERMISSION_CATEGORIES } from './PermissionsContext';
export type { DomainPermissionEntry, Permission } from './PermissionsContext';

export { WorkspaceContext, WorkspaceProvider, useWorkspace } from './WorkspaceContext';
export type { WorkspaceState } from './WorkspaceContext';
