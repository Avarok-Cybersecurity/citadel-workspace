/**
 * Loads the Calendar's glue: the module by dynamic import (its own chunk, fetched only when a
 * Calendar mounts) and its binary from its stable URL, compiled while it streams.
 */
import { CALENDAR_WASM_URL } from '../asset-urls';

export type CalendarGlue = typeof import('../../../../vendor/calendar/calendar_glue.js');

export async function loadCalendarWasm(): Promise<CalendarGlue> {
  const glue: CalendarGlue = await import('../../../../vendor/calendar/calendar_glue.js');
  await glue.default({ module_or_path: CALENDAR_WASM_URL });
  return glue;
}
