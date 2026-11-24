/**
 * The host-owned element an app paints in: one canvas filling its host (its bitmap at the device
 * pixel ratio, handed to the app's worker as an OffscreenCanvas), and a status line over it while
 * the app is starting or after it stopped. The app never gets page DOM; the status is the host's
 * words, never the app's.
 */
import type { AppEvent } from '../sdk/generated/AppEvent';
import type { CanvasRegion } from '../host/canvas-limits';
import { regionOverlay, type RegionOverlay } from './region-overlay';

export type SurfaceState = { readonly kind: 'starting' } | { readonly kind: 'running' } | { readonly kind: 'stopped'; readonly why: string };

export interface ZoneSurface {
  readonly canvas: HTMLCanvasElement;
  readonly show: (state: SurfaceState) => void;
  /** The last painted frame's regions (region-overlay.ts); shown only while the app runs. */
  readonly regions: (list: readonly CanvasRegion[]) => void;
  readonly dispose: () => void;
}

/** A zone's size as the app's `resize` event carries it: CSS pixels, and the device pixel ratio. */
export type SurfaceSize = Readonly<Extract<AppEvent, { resize: unknown }>['resize']>;

/**
 * `fill`: the canvas is as tall as its host (a tab or a page), not the zone's fixed height.
 * `activate`: a region a person activated, by id (the mount delivers it while the app runs).
 */
export function zoneSurface(host: HTMLElement, appName: string, size: SurfaceSize, fill: boolean, activate: (id: string) => void): ZoneSurface {
  const doc: Document = host.ownerDocument;
  const canvas: HTMLCanvasElement = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size.width * size.dpr));
  canvas.height = Math.max(1, Math.round(size.height * size.dpr));
  canvas.style.width = '100%';
  canvas.style.height = fill ? '100%' : `${size.height}px`;
  canvas.style.display = 'block';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', appName);
  canvas.dataset.testid = 'app-zone-canvas';
  const status: HTMLParagraphElement = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.dataset.testid = 'app-zone-status';
  status.className = 'absolute inset-0 m-0 flex items-center justify-center rounded-lg border border-dashed border-border bg-muted p-[16px] text-center text-sm text-muted-foreground';
  host.style.position = 'relative';
  const overlay: RegionOverlay = regionOverlay(canvas, activate);
  host.append(canvas, overlay.element, status);
  const show = (state: SurfaceState): void => {
    host.dataset.appState = state.kind;
    if (state.kind !== 'running') overlay.show([]);
    // Not `hidden`: the `flex` utility outranks the preflight's [hidden] rule.
    status.style.display = state.kind === 'running' ? 'none' : '';
    status.textContent = state.kind === 'starting' ? `Starting ${appName}…` : state.kind === 'stopped' ? state.why : '';
  };
  show({ kind: 'starting' });
  return {
    canvas,
    show,
    regions: (list: readonly CanvasRegion[]): void => overlay.show(host.dataset.appState === 'running' ? list : []),
    dispose: (): void => {
      overlay.dispose();
      canvas.remove();
      status.remove();
      delete host.dataset.appState;
    },
  };
}
