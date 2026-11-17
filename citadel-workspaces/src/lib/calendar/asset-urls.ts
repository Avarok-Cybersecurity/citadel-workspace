/**
 * Where the Calendar's binary is served: a stable, unhashed URL, precached with the app shell
 * (vite.config.ts) like Citadel Docs' binaries. scripts/build-calendar-glue.mjs writes this URL
 * into the glue, which the vendored-pair test checks.
 */
export const CALENDAR_WASM_URL: string = '/calendar/calendar_glue_bg.wasm';
