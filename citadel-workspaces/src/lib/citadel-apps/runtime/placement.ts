/**
 * Where an instance runs: a zone in a page (`md_zone`, of the author's height, resized in width
 * only) or a tab of a node's pane (`node_tab`, filling the panel, resized in both dimensions). The
 * app is told which through `AppContext.surface`, and runs only where its manifest says it can.
 */
import type { AppManifest, AppSurface } from 'citadel-workspace-client-ts';
import type { Surface } from '../sdk/generated/Surface';

export type Placement =
  | { readonly kind: 'zone'; readonly zoneId: string; readonly height: number }
  | { readonly kind: 'tab'; readonly tabId: string };

export interface PlacedSize {
  /** CSS pixels, each at least 1. */
  readonly width: number;
  readonly height: number;
}

export function surfaceKind(kind: Placement['kind']): AppSurface {
  return kind === 'zone' ? 'md_zone' : 'node_tab';
}

/** Whether `manifest` lists the surface a placement of `kind` mounts. */
export function runsOn(manifest: Pick<AppManifest, 'surfaces'>, kind: Placement['kind']): boolean {
  return manifest.surfaces.includes(surfaceKind(kind));
}

export function surfaceOf(p: Placement): Surface {
  return p.kind === 'zone' ? { md_zone: { zone_id: p.zoneId } } : { node_tab: { tab_id: p.tabId } };
}

/** The placement's name on its page: the zone's, or the tab's. */
export function placementId(p: Placement): string {
  return p.kind === 'zone' ? p.zoneId : p.tabId;
}

/** The size the app is given for a host measured at `measured`: a zone keeps its author's height. */
export function sizeIn(p: Placement, measured: PlacedSize): PlacedSize {
  const width: number = Math.max(1, Math.round(measured.width));
  return { width, height: p.kind === 'zone' ? p.height : Math.max(1, Math.round(measured.height)) };
}
