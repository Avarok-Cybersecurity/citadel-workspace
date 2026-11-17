/**
 * The shapes the device-records seam (lib/document-replica-cache.ts) reads without loading any
 * cryptography: whether a stored value is sealed, the per-account setting, and the error a
 * sealed record raises when it cannot be opened here.
 */
import { LOCKED_ON_DEVICE } from './at-rest-copy';

/** One sealed record: AES-256-GCM over the value's CBOR, with this write's own nonce. */
export interface AtRestEnvelope {
  readonly atRest: 1;
  readonly iv: Uint8Array;
  readonly ct: Uint8Array;
}

export function isAtRestEnvelope(value: unknown): value is AtRestEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v: Record<string, unknown> = value as Record<string, unknown>;
  return v.atRest === 1 && ArrayBuffer.isView(v.iv) && ArrayBuffer.isView(v.ct);
}

/**
 * The account's setting on this device. `converting` is set before a sweep starts and cleared
 * when it ends, so a sweep cut short is finished on the next open.
 */
export interface AtRestMode {
  readonly on: boolean;
  readonly converting: boolean;
}

export const AT_REST_OFF: AtRestMode = { on: false, converting: false };

export function readAtRestMode(value: unknown): AtRestMode {
  if (value === undefined) return AT_REST_OFF;
  const v: Record<string, unknown> = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  if (typeof v.on !== 'boolean' || typeof v.converting !== 'boolean') throw new Error('the encryption setting on this device is not in the shape this client writes');
  return { on: v.on, converting: v.converting };
}

/** A sealed record with no key here to open it, or one that fails its tag: never shown as data. */
export class RecordLockedError extends Error {
  constructor(readonly key: string) {
    super(LOCKED_ON_DEVICE);
    this.name = 'RecordLockedError';
  }
}

export const isRecordLocked = (error: unknown): error is RecordLockedError => error instanceof Error && error.name === 'RecordLockedError';

/** Turning encryption on or off was refused; nothing was changed. The message says why. */
export class AtRestRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtRestRefusedError';
  }
}
