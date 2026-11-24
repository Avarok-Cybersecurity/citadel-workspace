/**
 * Draws its children only while this device's Dev mode is on (Settings -> Advanced). Not while the
 * setting is still being read: internals are never shown on a guess.
 */
import type { ReactNode } from 'react';
import { useDevMode } from '@/hooks/use-dev-mode';

export function DevModeOnly({ children }: { readonly children: ReactNode }): JSX.Element | null {
  return useDevMode() === true ? <>{children}</> : null;
}
