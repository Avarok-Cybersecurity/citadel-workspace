/**
 * CW-5 §2 on the page: the canvas's region overlay (region-overlay.ts) as the zone surface owns
 * it. Per region, one focusable element with the region's role and its label as the accessible
 * name, placed over its rectangle, in draw order; Enter, Space, a click on it, and a pointer click
 * on the canvas inside the rectangle activate it; each frame's list replaces the last, and one
 * without regions clears the overlay. No doubles: jsdom lays nothing out, so geometry is read from
 * the placed styles and the canvas's box is given (as runtime-rig.ts `hostOf` does).
 *
 * Negative controls (each applied, seen red, reverted): not appending the overlay to the host
 * fails every role query; dropping `regionAt`'s hit test fails the pointer case; replacing the
 * list by appending to it fails "a frame without regions clears".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, getAllByRole, getByRole, queryAllByRole } from '@testing-library/dom';
import type { CanvasRegion } from '../../host/canvas-limits';
import { zoneSurface, type ZoneSurface } from '../zone-surface';

afterEach(() => {
  document.body.innerHTML = '';
});

const R = (id: string, x: number, y: number, w: number, h: number, label: string, role: CanvasRegion['role'] = 'button'): CanvasRegion => ({ id, x, y, w, h, label, role });

function mounted(): { host: HTMLDivElement; surface: ZoneSurface; activated: string[]; canvas: HTMLCanvasElement } {
  const host: HTMLDivElement = document.createElement('div');
  document.body.append(host);
  const activated: string[] = [];
  const surface: ZoneSurface = zoneSurface(host, 'Graph', { width: 400, height: 300, dpr: 1 }, true, (id: string): void => { activated.push(id); });
  const canvas: HTMLCanvasElement = host.querySelector('canvas') as HTMLCanvasElement;
  canvas.getBoundingClientRect = (): DOMRect => ({ x: 100, y: 50, left: 100, top: 50, right: 500, bottom: 350, width: 400, height: 300, toJSON: () => ({}) });
  surface.show({ kind: 'running' });
  return { host, surface, activated, canvas };
}

const boxOf = (el: HTMLElement): number[] => [el.style.left, el.style.top, el.style.width, el.style.height].map((v: string) => parseFloat(v));

describe('a frame with regions', () => {
  it('yields one element per region with its role and accessible name, in draw order, over its rectangle', () => {
    const { host, surface } = mounted();
    surface.regions([R('ann', 10, 20, 30, 40, 'Ann, lead'), R('bob', 50, 60, 70, 80, 'Bob', 'link'), R('pic', 0, 0, 5, 5, 'Logo', 'img'), R('team', 1, 2, 3, 4, 'Team', 'group')]);
    const ann: HTMLElement = getByRole(host, 'button', { name: 'Ann, lead' });
    expect(boxOf(ann)).toEqual([10, 20, 30, 40]);
    expect(boxOf(getByRole(host, 'link', { name: 'Bob' }))).toEqual([50, 60, 70, 80]);
    expect(getByRole(host, 'img', { name: 'Logo' })).toBeTruthy();
    expect(getByRole(host, 'group', { name: 'Team' })).toBeTruthy();
    const order: (string | null)[] = [...host.querySelectorAll('[data-region-id]')].map((e: Element) => e.getAttribute('aria-label'));
    expect(order).toEqual(['Ann, lead', 'Bob', 'Logo', 'Team']);
    expect(ann.tabIndex).toBe(0);
    // Over the canvas's own box and clipped to it, painting nothing of its own.
    const layer: HTMLElement = host.querySelector('[data-testid="app-region-overlay"]') as HTMLElement;
    expect([layer.style.position, layer.style.left, layer.style.top, layer.style.width, layer.style.height, layer.style.overflow]).toEqual(['absolute', '0px', '0px', '100%', '100%', 'hidden']);
    expect(ann.className).toContain('focus-visible:ring-2');
    expect(ann.textContent).toBe('');
  });

  it('activates a region by Enter, by Space, by a click on it, and by a pointer click on the canvas inside it', () => {
    const { host, surface, activated, canvas } = mounted();
    surface.regions([R('a', 0, 0, 100, 100, 'A'), R('b', 50, 50, 100, 100, 'B')]);
    const a: HTMLElement = getByRole(host, 'button', { name: 'A' });
    fireEvent.keyDown(a, { key: 'Enter' });
    fireEvent.keyDown(a, { key: ' ' });
    fireEvent.keyDown(a, { key: 'x' });
    fireEvent.click(getByRole(host, 'button', { name: 'B' }));
    fireEvent.click(canvas, { clientX: 100 + 10, clientY: 50 + 10 });
    fireEvent.click(canvas, { clientX: 100 + 60, clientY: 50 + 60 });
    fireEvent.click(canvas, { clientX: 100 + 300, clientY: 50 + 10 });
    // The overlap goes to the one drawn last (on top); a click outside every region activates nothing.
    expect(activated).toEqual(['a', 'a', 'b', 'a', 'b']);
  });

  it('is replaced by the next frame, keeping focus on a region that stayed, and a frame without regions clears it', () => {
    const { host, surface } = mounted();
    surface.regions([R('a', 0, 0, 10, 10, 'A'), R('b', 0, 0, 10, 10, 'B')]);
    getByRole(host, 'button', { name: 'B' }).focus();
    surface.regions([R('a', 5, 5, 10, 10, 'A moved'), R('b', 9, 9, 10, 10, 'B')]);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('B');
    surface.regions([R('c', 0, 0, 10, 10, 'C'), R('b', 9, 9, 10, 10, 'B')]);
    expect(getAllByRole(host, 'button').map((e: HTMLElement) => e.getAttribute('aria-label'))).toEqual(['C', 'B']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('B');
    surface.regions([]);
    expect(queryAllByRole(host, 'button')).toEqual([]);
  });

  it('is shown only while the app runs: a stopped app leaves no reachable region behind', () => {
    const { host, surface } = mounted();
    surface.regions([R('a', 0, 0, 10, 10, 'A')]);
    expect(getAllByRole(host, 'button')).toHaveLength(1);
    surface.show({ kind: 'stopped', why: 'Graph stopped because of an error.' });
    expect(queryAllByRole(host, 'button')).toEqual([]);
    surface.regions([R('a', 0, 0, 10, 10, 'A')]);
    expect(queryAllByRole(host, 'button')).toEqual([]);
  });
});
