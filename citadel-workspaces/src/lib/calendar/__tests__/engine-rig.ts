/**
 * The real Calendar engine for tests: the vendored glue initialised from its committed binary, over
 * the page's own Intl adapter. Nothing in the path is faked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as glue from '../../../../vendor/calendar/calendar_glue.js';
import { CalendarEngine } from '../engine/calendar-engine';
import { intlOffsetAt, type OffsetAt } from '../engine/intl-offsets';

let initialised: boolean = false;

/**
 * `offsetAt` defaults to the page's own adapter (the real path); a test passes another only to
 * prove what the engine does with a faulty one.
 */
export function realEngine(offsetAt: OffsetAt = intlOffsetAt()): CalendarEngine {
  if (!initialised) {
    glue.initSync({ module: readFileSync(join(process.cwd(), 'public/calendar/calendar_glue_bg.wasm')) });
    initialised = true;
  }
  return new CalendarEngine(glue, offsetAt);
}

export { at, event, NY, utc } from './event-fixture';
