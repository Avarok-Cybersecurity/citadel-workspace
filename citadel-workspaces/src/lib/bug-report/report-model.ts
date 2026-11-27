/**
 * A bug report as the person previews it and as it is sent (RECOVERY-DESIGN.md §3). Pure.
 *
 * Every field is a string, a number or a boolean: no BigInt, so the JSON body is exact, and no
 * CID or name of anyone. Each item the person may remove has an id the preview addresses; the
 * build and the surface it came from cannot be removed, being the least a report must say.
 */
import type { TrailEvent } from '@/lib/recovery-route/trail';
import type { RingLine } from './ring';
import type { Crumb } from './breadcrumbs';

export const REPORT_FORMAT: 1 = 1;
/** Most bytes one report may be, serialised; the control plane refuses more (bug-reports.mjs). */
export const MAX_REPORT_BYTES: number = 96 * 1024;
export const MAX_NOTE_CHARS: number = 4_000;

export interface ContextItem {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly removable: boolean;
}

export interface BugReport {
  readonly format: typeof REPORT_FORMAT;
  readonly surface: string;
  readonly note: string;
  /** `handle@host`, only when the person ticked "Avarok may contact me". */
  readonly contact: string | null;
  readonly context: readonly ContextItem[];
  readonly console: readonly RingLine[];
  readonly crumbs: readonly Crumb[];
  readonly trail: readonly TrailEvent[];
}

export type Section = 'context' | 'console' | 'crumbs' | 'trail';

const encoder: TextEncoder = new TextEncoder();

export function reportBytes(report: BugReport): number {
  return encoder.encode(JSON.stringify(report)).length;
}

/** The report without one item; a context item that may not be removed stays. */
export function withoutItem(report: BugReport, section: Section, index: number): BugReport {
  switch (section) {
    case 'context': return report.context[index]?.removable === true ? { ...report, context: report.context.filter((_: ContextItem, i: number): boolean => i !== index) } : report;
    case 'console': return { ...report, console: report.console.filter((_: RingLine, i: number): boolean => i !== index) };
    case 'crumbs': return { ...report, crumbs: report.crumbs.filter((_: Crumb, i: number): boolean => i !== index) };
    case 'trail': return { ...report, trail: report.trail.filter((_: TrailEvent, i: number): boolean => i !== index) };
  }
}

/** The report without a whole section's removable items. */
export function withoutSection(report: BugReport, section: Section): BugReport {
  switch (section) {
    case 'context': return { ...report, context: report.context.filter((item: ContextItem): boolean => !item.removable) };
    case 'console': return { ...report, console: [] };
    case 'crumbs': return { ...report, crumbs: [] };
    case 'trail': return { ...report, trail: [] };
  }
}

/** Within the size cap: the oldest console lines go first, then the oldest crumbs. */
export function fitted(report: BugReport): BugReport {
  let out: BugReport = { ...report, note: report.note.slice(0, MAX_NOTE_CHARS) };
  while (reportBytes(out) > MAX_REPORT_BYTES && out.console.length > 0) out = { ...out, console: out.console.slice(1) };
  while (reportBytes(out) > MAX_REPORT_BYTES && out.crumbs.length > 0) out = { ...out, crumbs: out.crumbs.slice(1) };
  return out;
}
