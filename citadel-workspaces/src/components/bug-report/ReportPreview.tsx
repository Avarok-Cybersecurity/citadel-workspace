/**
 * "What will be sent": every item the report holds, each removable, with the report's size.
 */
import { Button } from '@/components/ui/button';
import { MAX_REPORT_BYTES, reportBytes, withoutItem, withoutSection, type BugReport, type Section } from '@/lib/bug-report/report-model';

interface Row { readonly text: string; readonly removable: boolean }

function rowsOf(report: BugReport, section: Section): Row[] {
  switch (section) {
    case 'context': return report.context.map((c): Row => ({ text: `${c.label}: ${c.value}`, removable: c.removable }));
    case 'console': return report.console.map((l): Row => ({ text: `${l.source}: ${l.message}${l.repeats > 1 ? ` (×${l.repeats})` : ''}`, removable: true }));
    case 'crumbs': return report.crumbs.map((c): Row => ({ text: `${c.dir} ${c.kind}`, removable: true }));
    case 'trail': return report.trail.map((t): Row => ({ text: t.kind === 'shown' ? `shown ${t.surface}` : `pressed ${t.route} on ${t.surface}`, removable: true }));
  }
}

const TITLES: { readonly [K in Section]: string } = {
  context: 'About this app',
  console: 'Console errors and warnings',
  crumbs: 'Recent requests (kinds only)',
  trail: 'Problems shown and buttons pressed',
};

const SECTIONS: readonly Section[] = ['context', 'console', 'crumbs', 'trail'];

export function ReportPreview({ report, onChange }: { readonly report: BugReport; readonly onChange: (next: BugReport) => void }): JSX.Element {
  const kib: number = Math.ceil(reportBytes(report) / 1024);
  return (
    <details className="text-sm" data-testid="bug-report-preview">
      <summary className="cursor-pointer">What will be sent ({kib} of {MAX_REPORT_BYTES / 1024} KB)</summary>
      <div className="mt-2 flex flex-col gap-3">
        {SECTIONS.map((section: Section): JSX.Element => {
          const rows: Row[] = rowsOf(report, section);
          return (
            <section key={section} className="flex flex-col gap-1" data-testid={`bug-report-section-${section}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{TITLES[section]} ({rows.length})</h3>
                {rows.some((r: Row): boolean => r.removable) && (
                  <Button variant="ghost" className="min-h-[44px]" onClick={(): void => onChange(withoutSection(report, section))} data-testid={`bug-report-remove-all-${section}`}>Remove all</Button>
                )}
              </div>
              <ul className="flex flex-col gap-1">
                {rows.map((row: Row, index: number): JSX.Element => (
                  <li key={`${section}-${index}`} className="flex items-start justify-between gap-2 break-all font-mono text-xs">
                    <span>{row.text}</span>
                    {row.removable && (
                      <Button variant="ghost" className="min-h-[44px] min-w-[44px] shrink-0" aria-label={`Remove: ${row.text.slice(0, 40)}`} onClick={(): void => onChange(withoutItem(report, section, index))} data-testid="bug-report-remove-item">×</Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
