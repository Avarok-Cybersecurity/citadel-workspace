/**
 * The app runtime a page mounts through (design 2.3, 2.4): a zone in a page (`mount`) and a tab of
 * a node's pane (`mountPane`) go through the same steps (mount-steps.ts), placed differently
 * (placement.ts). One runtime per page, so one plane registry and one instance cap: every instance
 * of an install here shares the registry, and zones and tabs count against the same slots.
 */
import type { AppTabMount, AppZoneHandle, AppZoneMount, AppZoneRuntime, GlueHandle, GlueTabMount, ZoneHost } from '@/components/office/app-zone/app-zone-environment';
import { bindGlue } from './glue-steps';
import { InstallPlaneRegistry } from './install-plane-registry';
import { mountPlaced, type ZoneRuntimeDeps } from './mount-steps';

export function createAppZoneRuntime(deps: ZoneRuntimeDeps): AppZoneRuntime {
  const planes: InstallPlaneRegistry = new InstallPlaneRegistry();
  return {
    mount: (host: ZoneHost, zone: AppZoneMount): AppZoneHandle => mountPlaced(host, {
      install: zone.install, name: zone.manifest.name, nodeId: zone.nodeId, me: zone.me,
      placement: { kind: 'zone', zoneId: zone.zoneId, height: zone.height },
    }, deps, planes),
    mountPane: (host: ZoneHost, tab: AppTabMount): AppZoneHandle => mountPlaced(host, {
      install: tab.install, name: tab.manifest.name, nodeId: tab.nodeId, me: tab.me,
      placement: { kind: 'tab', tabId: tab.tabId },
    }, deps, planes),
    bindGlue: (tab: GlueTabMount): GlueHandle => bindGlue(tab, deps, planes),
  };
}
