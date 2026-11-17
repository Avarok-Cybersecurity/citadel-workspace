/**
 * Permissions Context
 *
 * React context for managing user permissions throughout the application.
 * Provides real-time permission state and checking utilities.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  permissionsService,
  Permission,
  DomainPermissions,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
} from '@/lib/permissions-service';
import { eventEmitter } from '@/lib/event-emitter';
import { debugLog } from '@/lib/debug-config';

/**
 * Context type definition
 */
interface PermissionsContextType {
  // State
  permissions: Map<string, DomainPermissions>;
  loading: boolean;
  error: string | null;

  // Permission checks
  hasPermission: (domainId: string, permission: Permission) => boolean;
  hasAnyPermission: (domainId: string, permissions: Permission[]) => boolean;
  hasAllPermissions: (domainId: string, permissions: Permission[]) => boolean;


  // Actions
  refreshPermissions: (domainId?: string) => Promise<void>;
  fetchPermissionsForDomain: (domainId: string) => Promise<DomainPermissions | null>;

  // Utilities
  getPermissionLabel: (permission: Permission) => string;
  getDeniedReason: (domainId: string, permission: Permission) => string;
}

const PermissionsContext: React.Context<PermissionsContextType | null> = createContext<PermissionsContextType | null>(null);

/**
 * Permissions Provider component
 */
export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [permissions, setPermissions] = useState<Map<string, DomainPermissions>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Sync state with service cache
   */
  const syncWithService: () => void = useCallback((): void => {
    const cached: Map<string, DomainPermissions> = permissionsService.getAllCachedPermissions();
    setPermissions(new Map(cached));
  }, []);

  /**
   * Fetch permissions for a specific domain
   */
  const fetchPermissionsForDomain: (domainId: string) => Promise<DomainPermissions | null> = useCallback(async (domainId: string): Promise<DomainPermissions | null> => {
    setLoading(true);
    setError(null);
    try {
      const result: DomainPermissions | null = await permissionsService.fetchPermissions(domainId);
      // Only sync if we got a result - avoids infinite loop when no user is logged in
      if (result) {
        syncWithService();
      }
      return result;
    } catch (err) {
      const message: string = err instanceof Error ? err.message : 'Failed to fetch permissions';
      setError(message);
      debugLog('PermissionsContext', 'Error fetching permissions:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [syncWithService]);

  /**
   * Refresh all permissions or a specific domain
   */
  const refreshPermissions: (domainId?: string) => Promise<void> = useCallback(async (domainId?: string): Promise<void> => {
    if (domainId) {
      await fetchPermissionsForDomain(domainId);
    } else {
      // Refresh all cached domains
      const cached: Map<string, DomainPermissions> = permissionsService.getAllCachedPermissions();
      setLoading(true);
      try {
        await Promise.all(
          Array.from(cached.keys()).map(id => permissionsService.fetchPermissions(id, true))
        );
        syncWithService();
      } catch (err) {
        const message: string = err instanceof Error ? err.message : 'Failed to refresh permissions';
        setError(message);
      } finally {
        setLoading(false);
      }
    }
  }, [fetchPermissionsForDomain, syncWithService]);

  /**
   * Permission check functions (delegated to service)
   */
  const hasPermission: (domainId: string, permission: Permission) => boolean = useCallback((domainId: string, permission: Permission): boolean => {
    return permissionsService.hasPermission(domainId, permission);
  }, []);

  const hasAnyPermission: (domainId: string, perms: Permission[]) => boolean = useCallback((domainId: string, perms: Permission[]): boolean => {
    return permissionsService.hasAnyPermission(domainId, perms);
  }, []);

  const hasAllPermissions: (domainId: string, perms: Permission[]) => boolean = useCallback((domainId: string, perms: Permission[]): boolean => {
    return permissionsService.hasAllPermissions(domainId, perms);
  }, []);


  /**
   * Utilities
   */
  const getPermissionLabel: (permission: Permission) => string = useCallback((permission: Permission): string => {
    return permissionsService.getPermissionLabel(permission);
  }, []);

  const getDeniedReason: (domainId: string, permission: Permission) => string = useCallback((domainId: string, permission: Permission): string => {
    return permissionsService.getDeniedReason(domainId, permission);
  }, []);

  /**
   * Setup event listeners for real-time updates
   */
  useEffect(() => {
    // Sync initial state
    syncWithService();

    // Listen for permission updates
    const handlePermissionsUpdated = (): void => {
      syncWithService();
    };

    const handleRoleChanged = (): void => {
      syncWithService();
    };

    const handlePermissionsLoaded = (): void => {
      syncWithService();
    };

    eventEmitter.on('permissions:updated', handlePermissionsUpdated);
    eventEmitter.on('permissions:role-changed', handleRoleChanged);
    eventEmitter.on('user:permissions:loaded', handlePermissionsLoaded);
    eventEmitter.on('permissions:cleared', handlePermissionsUpdated);

    return (): void => {
      eventEmitter.off('permissions:updated', handlePermissionsUpdated);
      eventEmitter.off('permissions:role-changed', handleRoleChanged);
      eventEmitter.off('user:permissions:loaded', handlePermissionsLoaded);
      eventEmitter.off('permissions:cleared', handlePermissionsUpdated);
    };
  }, [syncWithService]);

  /**
   * Context value (memoized to prevent unnecessary re-renders)
   */
  const value: PermissionsContextType = useMemo<PermissionsContextType>(() => ({
    permissions,
    loading,
    error,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refreshPermissions,
    fetchPermissionsForDomain,
    getPermissionLabel,
    getDeniedReason,
  }), [
    permissions,
    loading,
    error,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refreshPermissions,
    fetchPermissionsForDomain,
    getPermissionLabel,
    getDeniedReason,
  ]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
};

/**
 * Hook to access permissions context
 */
export function usePermissions(): PermissionsContextType {
  const context: PermissionsContextType | null = useContext(PermissionsContext);
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionsProvider');
  }
  return context;
}

// Re-export types and constants for convenience
export { Permission, PERMISSION_LABELS, PERMISSION_CATEGORIES };
export type { DomainPermissions };
