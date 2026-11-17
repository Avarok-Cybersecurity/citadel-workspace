/**
 * Input for an app's canvas: the page's DOM events as `AppEvent`s, in CSS pixels relative to the
 * canvas, forwarded only for the kinds the app subscribed to (`events.subscribe`; none until it
 * asks). Nothing about the page beyond the canvas reaches the app. The events port the app calls
 * is here too, so what it subscribes to and what is forwarded are one state.
 */
import type { AppEvent } from '../sdk/generated/AppEvent';
import type { EventKind } from '../sdk/generated/EventKind';
import type { Modifiers } from '../sdk/generated/Modifiers';
import type { PointerKind } from '../sdk/generated/PointerKind';
import type { PointerType } from '../sdk/generated/PointerType';
import type { EventsPort, PortAnswer } from '../host/ports';

/** Starts frame callbacks (requestAnimationFrame on a page); returns the stop. */
export type FrameLoop = (tick: (dtMs: number) => void) => () => void;

export interface ZoneInput {
  readonly port: EventsPort;
  /** Starts forwarding to `post`; returns the detach (which also stops frames). */
  readonly attach: (canvas: HTMLElement, post: (event: AppEvent) => void, frame: (dtMs: number) => void) => () => void;
}

const modifiers = (e: KeyboardEvent | MouseEvent): Modifiers => ({ shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
const POINTER_KINDS: Readonly<Record<string, PointerKind>> = {
  pointerdown: 'down', pointerup: 'up', pointermove: 'move', pointerenter: 'enter', pointerleave: 'leave', pointercancel: 'cancel',
};
const pointerType = (t: string): PointerType => (t === 'pen' || t === 'touch' ? t : 'mouse');

export function zoneInput(frames: FrameLoop): ZoneInput {
  let kinds: ReadonlySet<EventKind> = new Set<EventKind>();
  let wantFrames: boolean = false;
  let stopFrames: (() => void) | null = null;
  let tick: ((dtMs: number) => void) | null = null;
  const syncFrames = (): void => {
    if (wantFrames && tick !== null && stopFrames === null) stopFrames = frames(tick);
    if ((!wantFrames || tick === null) && stopFrames !== null) {
      stopFrames();
      stopFrames = null;
    }
  };
  const port: EventsPort = {
    Subscribe: ({ kinds: asked }): PortAnswer<null> => {
      kinds = new Set<EventKind>(asked);
      return { ok: null };
    },
    RequestFrames: ({ on }): PortAnswer<null> => {
      wantFrames = on;
      syncFrames();
      return { ok: null };
    },
  };
  const attach = (el: HTMLElement, post: (event: AppEvent) => void, frame: (dtMs: number) => void): (() => void) => {
    tick = frame;
    syncFrames();
    const at = (e: MouseEvent): { x: number; y: number } => {
      const r: DOMRect = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onPointer = (e: PointerEvent): void => {
      if (!kinds.has('pointer')) return;
      post({ pointer: { kind: POINTER_KINDS[e.type], pointer_type: pointerType(e.pointerType), ...at(e), button: Math.max(0, e.button), buttons: e.buttons, modifiers: modifiers(e) } });
    };
    const onWheel = (e: globalThis.WheelEvent): void => {
      if (!kinds.has('wheel')) return;
      e.preventDefault();
      post({ wheel: { ...at(e), dx: e.deltaX, dy: e.deltaY, modifiers: modifiers(e) } });
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!kinds.has('key')) return;
      post({ key: { down: e.type === 'keydown', key: e.key, code: e.code, repeat: e.repeat, modifiers: modifiers(e) } });
    };
    const onFocus = (e: FocusEvent): void => { if (kinds.has('focus')) post({ focus: { focused: e.type === 'focus' } }); };
    const onVisibility = (): void => { if (kinds.has('visibility')) post({ visibility: { visible: document.visibilityState === 'visible' } }); };
    const listeners: [string, EventListener, AddEventListenerOptions | undefined][] = [
      ...Object.keys(POINTER_KINDS).map((t: string): [string, EventListener, undefined] => [t, onPointer as EventListener, undefined]),
      ['wheel', onWheel as EventListener, { passive: false }],
      ['keydown', onKey as EventListener, undefined], ['keyup', onKey as EventListener, undefined],
      ['focus', onFocus as EventListener, undefined], ['blur', onFocus as EventListener, undefined],
    ];
    for (const [t, l, o] of listeners) el.addEventListener(t, l, o);
    document.addEventListener('visibilitychange', onVisibility);
    return (): void => {
      for (const [t, l, o] of listeners) el.removeEventListener(t, l, o);
      document.removeEventListener('visibilitychange', onVisibility);
      tick = null;
      syncFrames();
    };
  };
  return { port, attach };
}

/** The page's frame loop: requestAnimationFrame, with the time since the previous frame. */
export const animationFrames: FrameLoop = (tick: (dtMs: number) => void): (() => void) => {
  let last: number | null = null;
  let id: number = requestAnimationFrame(function step(now: number): void {
    tick(last === null ? 0 : now - last);
    last = now;
    id = requestAnimationFrame(step);
  });
  return (): void => cancelAnimationFrame(id);
};
