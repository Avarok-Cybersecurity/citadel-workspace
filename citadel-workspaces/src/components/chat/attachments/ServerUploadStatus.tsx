/**
 * A file going to the workspace server, under the transcript: how much the server has stored,
 * then that it is shared, or the server's reason for refusing it, until dismissed. A live region
 * announces the start, each quarter and the outcome (server-upload), never every chunk.
 */
import { AlertCircle, Check, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TransferProgressBar } from '@/components/p2p/bubbles/TransferProgressBar';
import { uploadPercent } from '@/lib/chat/attachments/server-upload';
import type { ServerUploadView } from './use-server-upload';

export function ServerUploadStatus({ view }: { view: ServerUploadView }): JSX.Element {
  const { upload } = view;
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only" data-testid="server-upload-announced">{view.announced}</p>
      {upload !== null && (
        <div data-testid="server-upload" data-upload-state={upload.kind} className="border-t border-border bg-muted/40 px-4 py-2 text-foreground">
          {upload.kind === 'uploading' ? (
            <>
              <p className="mb-1 flex min-w-0 items-center gap-2 text-sm">
                <Upload aria-hidden="true" className="h-4 w-4 shrink-0 text-primary-accent" />
                <span className="min-w-0 [overflow-wrap:anywhere]">Uploading {upload.name}</span>
              </p>
              <TransferProgressBar
                percent={uploadPercent(upload)} doneBytes={upload.storedBytes} totalBytes={upload.totalBytes}
                label={`Upload of ${upload.name}`} onPrimary={false}
              />
            </>
          ) : (
            <div className="flex items-center gap-2">
              {upload.kind === 'shared'
                ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-success-emphasis" />
                : <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" />}
              <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                <p>{upload.kind === 'shared' ? `Shared ${upload.name} with the channel` : `${upload.name} was not shared`}</p>
                {upload.kind === 'refused' && <p className="text-xs text-muted-foreground">{upload.reason}</p>}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={view.dismiss} data-testid="server-upload-dismiss" className="h-[44px] min-w-[44px] shrink-0">
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
