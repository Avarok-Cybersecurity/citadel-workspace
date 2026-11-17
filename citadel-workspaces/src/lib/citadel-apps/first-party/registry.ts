/**
 * How an install's app is mounted, by its manifest's ABI (`sdk.abi`): a Citadel App ABI module runs
 * in its own worker on a host-owned canvas (runtime/mount-steps.ts); a first-party glue app is
 * React in the UI bundle, loaded lazily, that reaches its ports through a GlueInstance
 * (host/glue-instance.ts). The tab system asks only `mountFor`; which glue apps exist is this
 * registry, filled by the first-party apps themselves.
 */
import type { ComponentType } from 'react';
import type { AppInstall, AppManifest } from 'citadel-workspace-client-ts';
import { CALENDAR_APP_ID } from '@/lib/calendar/app-id';
import type { GlueInstance } from '../host/glue-instance';
import { ABI_FIRST_PARTY_GLUE, ABI_V1 } from '../manifest/manifest-rules';

export type MountKind = 'worker' | 'glue';

/** How a manifest of `abi` mounts; null for an ABI this page does not run. */
export function mountFor(abi: string): MountKind | null {
  if (abi === ABI_V1) return 'worker';
  if (abi === ABI_FIRST_PARTY_GLUE) return 'glue';
  return null;
}

/** What a glue app's tab is given: its install, where it is placed, and its ports, gated (glue-instance.ts). */
export interface GlueTabProps {
  readonly glue: GlueInstance;
  readonly install: AppInstall;
  readonly manifest: AppManifest;
  readonly nodeId: string;
  readonly me: string;
  readonly tabId: string;
  /**
   * Whether to offer the member changes to what the node itself holds: `EditMdx` on the node, or
   * not yet known (`permits`), since the kernel refuses a write the member may not make.
   */
  readonly mayEditNode: boolean;
}

export type GlueTabLoader = () => Promise<ComponentType<GlueTabProps>>;

/** App id -> its tab, loaded the first time it is shown. */
const GLUE_TABS: ReadonlyMap<string, GlueTabLoader> = new Map<string, GlueTabLoader>([
  [CALENDAR_APP_ID, (): Promise<ComponentType<GlueTabProps>> => import('@/components/calendar/CalendarMount').then((m) => m.CalendarMount)],
]);

export function glueTab(appId: string): GlueTabLoader | null {
  return GLUE_TABS.get(appId) ?? null;
}
