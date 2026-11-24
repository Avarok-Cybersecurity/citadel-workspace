/**
 * The accessibility overlay of an app's canvas (canvas-ext-abi.md §2): per `Region` of the last
 * painted frame, one invisible focusable element over its rectangle, with the region's role and
 * its label as the accessible name, in draw order (DOM order, so tab order). Enter or Space on it,
 * a click on it (what a screen reader's activation sends), and a pointer click on the canvas inside
 * its rectangle each activate it. Regions are replaced by each frame's list; an empty list clears
 * the overlay. The overlay paints nothing but the focus ring of the region a keyboard user is on.
 */
import type { CanvasRegion } from '../host/canvas-limits';

export interface RegionOverlay {
  readonly element: HTMLElement;
  /** Replaces the regions; an element whose region keeps its id and place keeps its focus. */
  readonly show: (regions: readonly CanvasRegion[]) => void;
  readonly dispose: () => void;
}

const FOCUS_RING: string = 'pointer-events-none absolute rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background';

/** The region a canvas point (CSS px from its top-left) falls in: the last drawn wins, as it is on top. */
export function regionAt(regions: readonly CanvasRegion[], x: number, y: number): CanvasRegion | null {
  for (let i: number = regions.length - 1; i >= 0; i--) {
    const r: CanvasRegion = regions[i];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  }
  return null;
}

function place(el: HTMLElement, r: CanvasRegion): void {
  el.setAttribute('role', r.role);
  el.setAttribute('aria-label', r.label);
  el.dataset.regionId = r.id;
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${Math.max(0, r.w)}px`;
  el.style.height = `${Math.max(0, r.h)}px`;
}

/** `canvas` is the app's; `activate` is told a region's id each time a person activates it. */
export function regionOverlay(canvas: HTMLCanvasElement, activate: (id: string) => void): RegionOverlay {
  const doc: Document = canvas.ownerDocument;
  const layer: HTMLDivElement = doc.createElement('div');
  layer.dataset.testid = 'app-region-overlay';
  // Over the canvas's own box, clipped to it: a region drawn past the edge is reachable only inside.
  layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;overflow:hidden;pointer-events:none;';
  let regions: readonly CanvasRegion[] = [];

  const fit = (): void => {
    layer.style.height = canvas.style.height;
  };
  const element = (r: CanvasRegion): HTMLDivElement => {
    const el: HTMLDivElement = doc.createElement('div');
    el.className = FOCUS_RING;
    el.tabIndex = 0;
    el.addEventListener('keydown', (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      activate(r.id);
    });
    el.addEventListener('click', (): void => activate(r.id));
    place(el, r);
    return el;
  };
  const onCanvasClick = (e: MouseEvent): void => {
    const box: DOMRect = canvas.getBoundingClientRect();
    const hit: CanvasRegion | null = regionAt(regions, e.clientX - box.left, e.clientY - box.top);
    if (hit !== null) activate(hit.id);
  };
  canvas.addEventListener('click', onCanvasClick);

  const show = (next: readonly CanvasRegion[]): void => {
    fit();
    const kids: HTMLElement[] = [...layer.children] as HTMLElement[];
    const sameIds: boolean = kids.length === next.length && next.every((r: CanvasRegion, i: number): boolean => kids[i].dataset.regionId === r.id);
    regions = next;
    if (sameIds) {
      next.forEach((r: CanvasRegion, i: number): void => place(kids[i], r));
      return;
    }
    const focused: string | null = kids.find((k: HTMLElement): boolean => k === doc.activeElement)?.dataset.regionId ?? null;
    layer.replaceChildren(...next.map(element));
    if (focused === null) return;
    const again: HTMLElement | undefined = ([...layer.children] as HTMLElement[]).find((k: HTMLElement): boolean => k.dataset.regionId === focused);
    again?.focus();
  };

  return {
    element: layer,
    show,
    dispose: (): void => {
      canvas.removeEventListener('click', onCanvasClick);
      regions = [];
      layer.remove();
    },
  };
}
