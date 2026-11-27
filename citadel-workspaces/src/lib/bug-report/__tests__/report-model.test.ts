/** Removing items from a report, and keeping it under the size the control plane accepts. */
import { describe, expect, it } from 'vitest';
import { MAX_REPORT_BYTES, REPORT_FORMAT, fitted, reportBytes, withoutItem, withoutSection, type BugReport } from '../report-model';
import type { RingLine } from '../ring';

const line = (message: string): RingLine => ({ at: 1, source: 'ConsoleError', message, stack: null, repeats: 1 });

const base: BugReport = {
  format: REPORT_FORMAT, surface: 'app.crash', note: '', contact: null,
  context: [
    { key: 'build', label: 'App version', value: 'seq 1', removable: false },
    { key: 'theme', label: 'Theme', value: 'dark', removable: true },
  ],
  console: [line('a'), line('b')], crumbs: [{ at: 1, dir: 'sent', kind: 'Telemetry' }], trail: [],
};

describe('the report model', () => {
  it('an item the person may not remove stays; one they may goes', () => {
    expect(withoutItem(base, 'context', 0).context).toHaveLength(2);
    expect(withoutItem(base, 'context', 1).context.map((c) => c.key)).toEqual(['build']);
    expect(withoutItem(base, 'console', 0).console.map((l) => l.message)).toEqual(['b']);
  });

  it('removing a section keeps the fixed context', () => {
    expect(withoutSection(base, 'context').context.map((c) => c.key)).toEqual(['build']);
    expect(withoutSection(base, 'console').console).toEqual([]);
  });

  it('fitted drops the oldest console lines until the report is under the cap', () => {
    const big: BugReport = { ...base, console: Array.from({ length: 400 }, (_, i: number) => line(`${i}:${'x'.repeat(500)}`)) };
    const fit: BugReport = fitted(big);
    expect(reportBytes(fit)).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(fit.console.at(-1)?.message.startsWith('399:')).toBe(true);
    expect(fit.console.length).toBeLessThan(400);
  });
});
