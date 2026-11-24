/**
 * Where an instance runs: a zone in a page (`md_zone`, of the author's height, resized in width
 * only), a tab of a node's pane (`node_tab`, filling the panel, resized in both dimensions), or the
 * node's page itself (`node_page`, node-page-abi.md §3: filling the pane, resized in both). The
 * app is told which through `AppContext.surface`, and runs only where its manifest says it can.
 */
import type { AppManifest, AppSurface } from 'citadel-workspace-client-ts';
import type { Surface } from '../sdk/generated/Surface';

export type Placement =
  | { readonly kind: 'zone'; readonly zoneId: string; readonly height: number }
  | { readonly kind: 'tab'; readonly tabId: string }
  | { readonly kind: 'page' };

export interface PlacedSize {
  /** CSS pixels, each at least 1. */
  readonly width: number;
  readonly height: number;
}

const SURFACE: Readonly<Record<Placement['kind'], AppSurface>> = { zone: 'md_zone', tab: 'node_tab', page: 'node_page' };

export function surfaceKind(kind: Placement['kind']): AppSurface {
  return SURFACE[kind];
}

/** Whether `manifest` lists the surface a placement of `kind` mounts. */
export function runsOn(manifest: Pick<AppManifest, 'surfaces'>, kind: Placement['kind']): boolean {
  return manifest.surfaces.includes(surfaceKind(kind));
}

export function surfaceOf(p: Placement): Surface {
  if (p.kind === 'zone') return { md_zone: { zone_id: p.zoneId } };
  return p.kind === 'tab' ? { node_tab: { tab_id: p.tabId } } : { node_page: {} };
}

/** The name a page's own app is audited under: a node has one page, so it needs no name of its own. */
export const PAGE_PLACEMENT_ID: string = 'node_page';

/** The placement's name on its page: the zone's, the tab's, or the page's. */
export function placementId(p: Placement): string {
  if (p.kind === 'zone') return p.zoneId;
  return p.kind === 'tab' ? p.tabId : PAGE_PLACEMENT_ID;
}

/** Where it runs, as a refusal says it: "in a page zone", "in a tab", "as a page". */
export function placementPhrase(kind: Placement['kind']): string {
  return kind === 'zone' ? 'in a page' : kind === 'tab' ? 'in a tab' : 'as a page';
}

/** The size the app is given for a host measured at `measured`: a zone keeps its author's height. */
export function sizeIn(p: Placement, measured: PlacedSize): PlacedSize {
  const width: number = Math.max(1, Math.round(measured.width));
  return { width, height: p.kind === 'zone' ? p.height : Math.max(1, Math.round(measured.height)) };
}
