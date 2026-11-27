/**
 * A problem report's shape, checked field by field (the client's report-model.ts, format 1). Any
 * field not named here is refused rather than stored: a report holds what the person previewed and
 * nothing else.
 */
export const MAX_REPORT_BYTES = 96 * 1024;
const MAX_NOTE = 4000;
const MAX_CONSOLE = 200;
const MAX_CRUMBS = 50;
const MAX_TRAIL = 20;
const MAX_CONTEXT = 16;
const SURFACE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,79}$/u;
const KIND = /^[A-Za-z0-9._-]{1,80}$/u;
const CONTACT = /^[^\s@]{1,64}@[a-z0-9.-]{1,253}(?::\d{1,5})?$/iu;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (v, keys) => isObject(v) && Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => k in v);
const str = (v, max) => typeof v === "string" && v.length <= max;
const num = (v) => Number.isSafeInteger(v) && v >= 0;

const line = (l) => onlyKeys(l, ["at", "source", "message", "stack", "repeats"]) && num(l.at)
  && (l.source === "ConsoleError" || l.source === "ConsoleWarn") && str(l.message, 1100)
  && (l.stack === null || str(l.stack, 2100)) && num(l.repeats) && l.repeats >= 1;
const crumb = (c) => onlyKeys(c, ["at", "dir", "kind"]) && num(c.at) && (c.dir === "sent" || c.dir === "received") && KIND.test(c.kind);
const trail = (t) => isObject(t) && num(t.at) && SURFACE.test(t.surface)
  && ((t.kind === "shown" && onlyKeys(t, ["at", "kind", "surface"])) || (t.kind === "taken" && onlyKeys(t, ["at", "kind", "surface", "route"]) && KIND.test(t.route)));
const item = (i) => onlyKeys(i, ["key", "label", "value", "removable"]) && KIND.test(i.key) && str(i.label, 40) && str(i.value, 200) && typeof i.removable === "boolean";

/** `{ report }` when `value` is a well-formed format-1 report, else `{ refusal }`. */
export function readReport(value) {
  const keys = ["format", "surface", "note", "contact", "context", "console", "crumbs", "trail"];
  if (!onlyKeys(value, keys) || value.format !== 1) return { refusal: "not a format-1 report" };
  if (!SURFACE.test(value.surface)) return { refusal: "surface" };
  if (!str(value.note, MAX_NOTE)) return { refusal: "note" };
  if (value.contact !== null && !(typeof value.contact === "string" && CONTACT.test(value.contact))) return { refusal: "contact" };
  if (!Array.isArray(value.context) || value.context.length > MAX_CONTEXT || !value.context.every(item)) return { refusal: "context" };
  if (!Array.isArray(value.console) || value.console.length > MAX_CONSOLE || !value.console.every(line)) return { refusal: "console" };
  if (!Array.isArray(value.crumbs) || value.crumbs.length > MAX_CRUMBS || !value.crumbs.every(crumb)) return { refusal: "crumbs" };
  if (!Array.isArray(value.trail) || value.trail.length > MAX_TRAIL || !value.trail.every(trail)) return { refusal: "trail" };
  return { report: value };
}
