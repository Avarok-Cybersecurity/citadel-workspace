/**
 * One glue call, typed at the engine's edge: the core's refusal is rethrown as a
 * `CalendarRefusal` with the core's code, anything else as it was.
 */
import type { Refusal } from '../generated/Refusal';
import type { RefusalCode } from '../generated/RefusalCode';

/** A value the core refused, with the core's code for why. */
export class CalendarRefusal extends Error {
  readonly code: RefusalCode;
  readonly detail: string | null;
  constructor(refusal: Refusal) {
    super(refusal.detail === null ? refusal.code : `${refusal.code}: ${refusal.detail}`);
    this.name = 'CalendarRefusal';
    this.code = refusal.code;
    this.detail = refusal.detail;
  }
}

function isRefusal(thrown: unknown): thrown is Refusal {
  if (typeof thrown !== 'object' || thrown === null) return false;
  const fields: Record<string, unknown> = thrown as Record<string, unknown>;
  return typeof fields.code === 'string' && (fields.detail === null || typeof fields.detail === 'string');
}

/** Runs one glue call; the core's refusal is rethrown typed, anything else as it was. */
export function call<T>(body: () => unknown): T {
  try {
    return body() as T;
  } catch (thrown: unknown) {
    if (isRefusal(thrown)) throw new CalendarRefusal(thrown);
    throw thrown;
  }
}
