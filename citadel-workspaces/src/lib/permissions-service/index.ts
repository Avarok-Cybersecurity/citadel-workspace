/**
 * Permissions Service - Barrel Export
 *
 * Re-exports ALL public exports from the module for backward compatibility.
 * Consumers import from '@/lib/permissions-service' (resolves to this file).
 */

// Types & constants
export { Permission, PERMISSION_LABELS, PERMISSION_CATEGORIES } from './types';
export type { UserRole, DomainPermissions } from './types';

// Service class
export { PermissionsService } from './service';

// Singleton instance
import { PermissionsService } from './service';
export const permissionsService: PermissionsService = PermissionsService.getInstance();

// Default export for convenience
export default permissionsService;
