/**
 * This browser's notification permission for a component, read again whenever the window comes
 * back to the front: a member who allows notifications in the browser's site settings, then
 * returns, sees the control change without reloading.
 */
import { useCallback, useEffect, useState } from 'react';
import type { OsPermission } from '@/lib/notification-service/os-decision';
import { askOsPermission, readOsPermission } from '@/lib/notification-service/os-permission';

export interface OsPermissionState {
  readonly permission: OsPermission;
  /** Call from a click handler only (os-permission.ts). */
  readonly ask: () => Promise<OsPermission>;
}

export function useOsPermission(): OsPermissionState {
  const [permission, setPermission] = useState<OsPermission>(readOsPermission);
  useEffect(() => {
    const reread: () => void = (): void => setPermission(readOsPermission());
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return (): void => {
      window.removeEventListener('focus', reread);
      document.removeEventListener('visibilitychange', reread);
    };
  }, []);
  const ask: () => Promise<OsPermission> = useCallback(async (): Promise<OsPermission> => {
    const answer: OsPermission = await askOsPermission();
    setPermission(answer);
    return answer;
  }, []);
  return { permission, ask };
}
