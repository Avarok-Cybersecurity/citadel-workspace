/**
 * A conversion report, shown: a summary line that is always visible, and every entry behind a
 * disclosure button (keyboard and touch, 44 px). Nothing in the report is left out or merged.
 * Each entry leads with its plain-language label; the summary counts the losses whose severity
 * is major, the ones that change what a reader sees (docs/loss-report.md in citadel-docs).
 */
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ConversionLoss, ConversionReport } from '@/lib/cdoc/editor/file-formats';
import { cn } from '@/lib/utils';

interface ConversionReportPanelProps {
  /** What was converted, e.g. "Opening report.docx". */
  readonly title: string;
  readonly report: ConversionReport;
  readonly testId: string;
}

function lossText(loss: ConversionLoss): string {
  if (loss.kind === 'macros') return `${loss.label}, never run: ${loss.part} (${loss.bytes.toString()} bytes)`;
  return `${loss.label}: ${loss.what} — ${loss.part}${loss.count > 1 ? ` (${loss.count} times)` : ''}`;
}

function summary(report: ConversionReport): string {
  const parts: string[] = [];
  const major: number = report.losses.filter((loss: ConversionLoss) => loss.severity === 'major').length;
  const visible: string = major === 0 ? '' : ` (${major} ${major === 1 ? 'changes' : 'change'} what you see)`;
  if (report.losses.length > 0) parts.push(`${report.losses.length} ${report.losses.length === 1 ? 'thing' : 'things'} could not be carried over${visible}`);
  if (report.problems.length > 0) parts.push(`${report.problems.length} ${report.problems.length === 1 ? 'problem' : 'problems'} found`);
  return parts.length === 0 ? 'nothing was lost.' : `${parts.join(', ')}.`;
}

export function ConversionReportPanel({ title, report, testId }: ConversionReportPanelProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const listId: string = useId();
  const entries: number = report.losses.length + report.problems.length;
  return (
    <section aria-label={title} data-testid={testId} className="border-b border-border bg-background px-[16px] py-[4px] text-sm">
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-[12px]">
        <p className="min-w-0 text-foreground">{title}: {summary(report)}</p>
        {entries > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o: boolean) => !o)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center gap-[4px] rounded px-[8px] text-primary-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? 'Hide details' : 'Show details'}
            <ChevronDown className={cn('h-[16px] w-[16px] transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </button>
        )}
      </div>
      {entries > 0 && (
        <ul id={listId} hidden={!open} className="max-h-[40vh] list-disc space-y-[2px] overflow-auto pb-[8px] pl-[20px] text-muted-foreground">
          {report.losses.map((loss: ConversionLoss, i: number) => <li key={`l${i}`}>{lossText(loss)}</li>)}
          {report.problems.map((problem: string, i: number) => <li key={`p${i}`}>Problem: {problem}</li>)}
        </ul>
      )}
    </section>
  );
}
