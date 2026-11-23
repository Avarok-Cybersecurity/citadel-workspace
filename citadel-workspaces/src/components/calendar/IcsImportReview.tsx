/**
 * The review of an .ics file opened in the Calendar (lib/calendar/ics-import.ts): what it holds,
 * each event's title and time, how many it holds, and what will not be imported and why. Nothing
 * is written until Import; Cancel, Escape or closing writes nothing. Imported events are the
 * member's own private events, saved one by one by the editor's path; the first refusal stops the
 * import and says how many were saved.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { Draft } from '@/lib/calendar/generated/Draft';
import type { IcsReading } from '@/lib/calendar/ics-import';
import { whenWords } from '@/lib/calendar/ics-import';

/** The most events the review lists by name; the count always says how many there are. */
const LISTED: number = 50;

export interface IcsImportReviewProps {
  readonly fileName: string;
  readonly reading: IcsReading;
  readonly floatingZone: string;
  readonly engine: Pick<CalendarEngine, 'civilOf'>;
  /** Saves every draft in order; resolves null when all were saved, else what happened. */
  readonly onImport: (drafts: readonly Draft[]) => Promise<string | null>;
  readonly onClose: (imported: number) => void;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

function Summary({ reading, floatingZone }: { reading: Extract<IcsReading, { ok: true }>; floatingZone: string }): JSX.Element {
  const notImported: string[] = [
    ...(reading.cancelled > 0 ? [`${plural(reading.cancelled, 'cancelled event')}`] : []),
    ...(reading.skipped.length > 0 ? [`${plural(reading.skipped.length, 'event')} the Calendar cannot read`] : []),
  ];
  return (
    <DialogDescription className="flex flex-col gap-1">
      <span data-testid="ics-import-count">{plural(reading.drafts.length, 'event')} to add to your own calendar.</span>
      {notImported.length > 0 && <span>Not imported: {notImported.join(' and ')}.</span>}
      <span>Times without a zone of their own are read in {floatingZone}.</span>
    </DialogDescription>
  );
}

export function IcsImportReview({ fileName, reading, floatingZone, engine, onImport, onClose }: IcsImportReviewProps): JSX.Element {
  const [busy, setBusy] = useState<boolean>(false);
  const [said, setSaid] = useState<string>('');
  const drafts: readonly Draft[] = reading.ok ? reading.drafts : [];
  const run = async (): Promise<void> => {
    setBusy(true);
    const failed: string | null = await onImport(drafts);
    setBusy(false);
    if (failed === null) onClose(drafts.length);
    else setSaid(failed);
  };
  return (
    <Dialog open onOpenChange={(open: boolean): void => { if (!open && !busy) onClose(0); }}>
      <DialogContent className="flex max-h-[90dvh] max-w-[560px] flex-col gap-3" data-testid="ics-import-review">
        <DialogTitle className="break-words pr-[48px]">Import {fileName}</DialogTitle>
        {reading.ok ? <Summary reading={reading} floatingZone={floatingZone} /> : <DialogDescription>{fileName} cannot be imported: {reading.why}.</DialogDescription>}
        {drafts.length > 0 && (
          <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border" aria-label="Events in the file">
            {drafts.slice(0, LISTED).map((d: Draft, i: number) => (
              <li key={`${d.uid}-${i}`} className="flex min-w-0 flex-col border-b border-border px-[12px] py-[8px] last:border-b-0" data-testid="ics-import-event">
                <span className="break-words text-sm font-medium text-foreground">{d.title === '' ? 'Untitled event' : d.title}</span>
                <span className="text-sm text-muted-foreground">{whenWords(d, engine)}</span>
              </li>
            ))}
            {drafts.length > LISTED && <li className="px-[12px] py-[8px] text-sm text-muted-foreground">and {drafts.length - LISTED} more</li>}
          </ul>
        )}
        <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="h-[44px]" disabled={busy} onClick={(): void => onClose(0)} data-testid="ics-import-cancel">Cancel</Button>
          {drafts.length > 0 && (
            <Button type="button" className="h-[44px]" disabled={busy} onClick={(): void => { void run(); }} data-testid="ics-import-confirm">
              {busy ? 'Importing…' : `Import ${plural(drafts.length, 'event')}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
