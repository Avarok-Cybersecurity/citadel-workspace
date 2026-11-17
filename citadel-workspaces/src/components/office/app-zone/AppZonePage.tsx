/**
 * The zone environment for one rendered page: this person, this page and its ancestors, whether
 * they may install for themselves, the page's apps data, the marketplace, and the zone names
 * already taken. `runtime` is the runtime stream's seam; it is passed explicitly (null until
 * apps can run), so nothing runs by default.
 */
import { useEffect, useMemo, useState } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { usePermission } from '@/hooks/use-permission';
import { confirms, permits } from '@/hooks/use-permission-result';
import { Permission } from '@/contexts/PermissionsContext';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { appLinkUrl, type AppLink } from '@/lib/citadel-apps/app-link';
import { openAppsModal } from '@/lib/citadel-apps/apps-modal-store';
import { sessionAppsTransport } from '@/lib/citadel-apps/apps-api';
import type { Tri } from '@/lib/citadel-apps/scope-options';
import { ancestorIdsOf } from '@/components/layout/sidebar/tree-node-utils';
import { AppZoneContext, zoneClaims, type AppZoneEnvironment, type AppZoneRuntime } from './app-zone-environment';
import { changesInstalls, zoneDataFrom } from './zone-data';

interface AppZonePageProps {
  nodeId: string;
  runtime: AppZoneRuntime | null;
  children: React.ReactNode;
}

export function AppZonePage({ nodeId, runtime, children }: AppZonePageProps): JSX.Element {
  const { state } = useWorkspace();
  const install: ReturnType<typeof usePermission> = usePermission(WORKSPACE_ROOT_ID, Permission.AppInstall);
  // A known yes, a known no, or not known yet -- which shows Install, Ask an admin, or neither.
  const mayInstall: Tri = confirms(install) ? 'yes' : permits(install) ? 'unknown' : 'no';
  const claims: ReturnType<typeof zoneClaims> = useMemo(zoneClaims, []);
  const me: string | null = state.currentUser?.username ?? null;
  const ancestors: string[] = useMemo((): string[] => ancestorIdsOf(state.nodes, nodeId), [state.nodes, nodeId]);
  // An install made, changed or removed anywhere in this tab (the marketplace, another zone) is read again.
  const [data, setData] = useState<AppZoneEnvironment['data']>(() => zoneDataFrom(sessionAppsTransport));
  useEffect(() => eventEmitter.on('workspace:apps', (event: { answer: unknown } | undefined): void => {
    if (event !== undefined && changesInstalls(event.answer)) setData(zoneDataFrom(sessionAppsTransport));
  }), []);

  const env: AppZoneEnvironment = useMemo((): AppZoneEnvironment => ({
    nodeId, me, ancestors, mayInstall, data, runtime,
    openLink: (link: AppLink): void => openAppsModal({ kind: 'link', link }),
    linkUrl: (link: AppLink): string => appLinkUrl(window.location.origin, link),
    copyText: (text: string): Promise<void> => navigator.clipboard.writeText(text),
    ...claims,
  }), [nodeId, me, ancestors, mayInstall, data, runtime, claims]);

  return <AppZoneContext.Provider value={env}>{children}</AppZoneContext.Provider>;
}
