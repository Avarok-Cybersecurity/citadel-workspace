/**
 * A chat document that does not open as a live canvas: what happened, in words, and the
 * original read-only where this device has one this account may read. A document that did not
 * load offers to try again.
 */
import { FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShowOriginal } from '@/components/documents/migration/ShowOriginal';
import { loadCdocRuntime } from '@/lib/cdoc/runtime-loader';
import { browserDocumentFiles } from '@/lib/document-files';
import { offersOriginal, unmovedCopy, type UnmovedCopy, type UnmovedReason } from './chat-document-copy';
import type { OriginalLoader } from './chat-document-opening';

interface UnmovedDocumentProps {
  readonly docId: string;
  readonly title: string;
  readonly peerName: string;
  readonly reason: UnmovedReason;
  readonly loadOriginal: OriginalLoader | null;
  readonly onRetry: () => void;
}

export function UnmovedDocument({ docId, title, peerName, reason, loadOriginal, onRetry }: UnmovedDocumentProps): JSX.Element {
  const copy: UnmovedCopy = unmovedCopy(reason, title, peerName);
  return (
    <section aria-label={copy.heading} data-testid="chat-document-unmoved" data-reason={reason.kind} className="flex min-h-0 min-w-0 flex-1 flex-col gap-[8px] overflow-auto bg-background px-[16px] py-[16px] text-sm">
      <div role="alert" className="flex min-w-0 items-start gap-[12px]">
        <FileWarning className="mt-[2px] h-[20px] w-[20px] shrink-0 text-destructive-emphasis" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{copy.heading}</h2>
          <p className="text-muted-foreground" data-testid="chat-document-unmoved-reason">{copy.body}</p>
        </div>
      </div>
      {reason.kind === 'failed' && reason.stage === 'load' && (
        <div><Button variant="outline" className="min-h-[44px]" onClick={onRetry} data-testid="chat-document-retry">Try again</Button></div>
      )}
      {loadOriginal !== null && offersOriginal(reason) && (
        <ShowOriginal docId={docId} loadOriginal={loadOriginal} files={browserDocumentFiles} loadCdocRuntime={loadCdocRuntime} />
      )}
    </section>
  );
}
