/**
 * A chat document that does not open as a live canvas: what happened, in words. A document
 * that did not load offers to try again.
 */
import { FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { unopenedCopy, type UnopenedCopy, type UnopenedReason } from './chat-document-copy';

interface UnopenedDocumentProps {
  readonly title: string;
  readonly peerName: string;
  readonly reason: UnopenedReason;
  readonly onRetry: () => void;
}

export function UnopenedDocument({ title, peerName, reason, onRetry }: UnopenedDocumentProps): JSX.Element {
  const copy: UnopenedCopy = unopenedCopy(reason, title, peerName);
  return (
    <section aria-label={copy.heading} data-testid="chat-document-unopened" data-reason={reason.kind} className="flex min-h-0 min-w-0 flex-1 flex-col gap-[8px] overflow-auto bg-background px-[16px] py-[16px] text-sm">
      <div role="alert" className="flex min-w-0 items-start gap-[12px]">
        <FileWarning className="mt-[2px] h-[20px] w-[20px] shrink-0 text-destructive-emphasis" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{copy.heading}</h2>
          <p className="text-muted-foreground" data-testid="chat-document-unopened-reason">{copy.body}</p>
        </div>
      </div>
      {reason.kind === 'load-failed' && (
        <div><Button variant="outline" className="min-h-[44px]" onClick={onRetry} data-testid="chat-document-retry">Try again</Button></div>
      )}
    </section>
  );
}
