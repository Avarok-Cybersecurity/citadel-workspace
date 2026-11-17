/**
 * The CBOR the guest decodes at app_init and app_event: the generated `AppContext` and `AppEvent`,
 * with their f32 fields written as CBOR floats (ciborium refuses an integer where Rust has f32, so
 * an integral dpr of 1 would otherwise be BAD_CONTEXT). Every other number is an integer.
 */
import type { AppContext } from '../sdk/generated/AppContext';
import type { AppEvent } from '../sdk/generated/AppEvent';
import type { WheelEvent } from '../sdk/generated/WheelEvent';
import { encodeCbor, f32 } from './cbor';

export function encodeAppContext(context: AppContext): Uint8Array {
  return encodeCbor({ ...context, dpr: f32(context.dpr) });
}

function withFloats(event: AppEvent): unknown {
  if (typeof event === 'string') return event;
  if ('resize' in event) return { resize: { ...event.resize, dpr: f32(event.resize.dpr) } };
  if ('pointer' in event) return { pointer: { ...event.pointer, x: f32(event.pointer.x), y: f32(event.pointer.y) } };
  if ('wheel' in event) {
    const w: WheelEvent = event.wheel;
    return { wheel: { ...w, x: f32(w.x), y: f32(w.y), dx: f32(w.dx), dy: f32(w.dy) } };
  }
  return event;
}

export function encodeAppEvent(event: AppEvent): Uint8Array {
  return encodeCbor(withFloats(event));
}
