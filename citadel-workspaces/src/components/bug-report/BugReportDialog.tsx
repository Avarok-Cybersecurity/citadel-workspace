/**
 * The bug reporter (RECOVERY-DESIGN.md §3.4): an optional note, then Send. Everything the report
 * holds is one tap away in "What will be sent", where each item can be removed; what is never
 * included is said in plain words. Nothing leaves this page until Send is pressed.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { BugReportRequest } from '@/lib/bug-report/request';
import { contactHandle, gatherReport } from '@/lib/bug-report/gather';
import { MAX_NOTE_CHARS, fitted, type BugReport } from '@/lib/bug-report/report-model';
import { sendReport, type SendOutcome } from '@/lib/bug-report/send';
import { ReportPreview } from './ReportPreview';
import { ReportSent } from './ReportSent';
import { describeFailure } from '@/lib/failure-message';

export interface BugReportDialogProps {
  readonly request: BugReportRequest | null;
  readonly onClose: () => void;
}

const NEVER_INCLUDED: readonly string[] = [
  'your messages, documents, files or file names',
  'passwords, recovery phrases, keys or sign-in tokens',
  'who you are talking to, their names or addresses',
  'screenshots',
];

export function BugReportDialog({ request, onClose }: BugReportDialogProps): JSX.Element {
  const [report, setReport] = useState<BugReport | null>(null);
  const [contactMe, setContactMe] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  useEffect((): void => {
    if (request === null) return;
    setReport(gatherReport(request.surface));
    setOutcome(null);
    setContactMe(false);
  }, [request]);
  const handle: string | null = request === null ? null : contactHandle();

  const send = (): void => {
    if (report === null) return;
    setSending(true);
    const ready: BugReport = fitted({ ...report, contact: contactMe ? handle : null });
    sendReport(fetch.bind(window), ready).then(
      setOutcome,
      (error: unknown): void => setOutcome({ kind: 'refused', sentence: describeFailure(error, 'The report could not be sent.') }),
    ).finally((): void => setSending(false));
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open: boolean): void => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="bug-report-dialog">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>Avarok can read what you send. Your workspace admins cannot.</DialogDescription>
        </DialogHeader>
        {outcome?.kind === 'sent' ? <ReportSent id={outcome.id} onClose={onClose} /> : report !== null && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bug-report-note">What happened? (optional)</Label>
              <Textarea
                id="bug-report-note"
                maxLength={MAX_NOTE_CHARS}
                value={report.note}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => setReport({ ...report, note: event.target.value })}
                data-testid="bug-report-note"
              />
            </div>
            {handle !== null && (
              <div className="flex items-center gap-2">
                <Checkbox id="bug-report-contact" checked={contactMe} onCheckedChange={(checked: boolean | 'indeterminate'): void => setContactMe(checked === true)} data-testid="bug-report-contact" />
                <Label htmlFor="bug-report-contact">Avarok may contact me about this ({handle})</Label>
              </div>
            )}
            <Button className="min-h-[44px]" disabled={sending} onClick={send} data-testid="bug-report-send">Send report</Button>
            {outcome?.kind === 'refused' && <ReportRefused sentence={outcome.sentence} report={report} />}
            <ReportPreview report={report} onChange={setReport} />
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer">Never included</summary>
              <ul className="mt-2 list-disc pl-5">{NEVER_INCLUDED.map((line: string): JSX.Element => <li key={line}>{line}</li>)}</ul>
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A report that did not go: why, and the two ways to send it by hand. */
function ReportRefused({ sentence, report }: { readonly sentence: string; readonly report: BugReport }): JSX.Element {
  const text: string = JSON.stringify(report, null, 2);
  const download = (): void => {
    const url: string = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link: HTMLAnchorElement = document.createElement('a');
    link.href = url;
    link.download = 'citadel-problem-report.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div role="alert" className="flex flex-col gap-2 text-sm" data-testid="bug-report-refused">
      <p className="text-foreground">{sentence}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-[44px]" onClick={(): void => { void navigator.clipboard.writeText(text); }} data-testid="bug-report-copy">Copy report</Button>
        <Button variant="outline" className="min-h-[44px]" onClick={download} data-testid="bug-report-download">Download report</Button>
      </div>
    </div>
  );
}
