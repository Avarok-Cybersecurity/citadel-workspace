/**
 * A chat file open in its app, in a dialog over the conversation: closing it returns to the
 * message, scrolled where it was. Docs shows the file read only, with the original's download.
 */
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DocsFileView } from '@/components/documents/DocsFileView';
import { loadCdocRuntime } from '@/lib/cdoc/runtime-loader';
import { browserDocumentFiles } from '@/lib/document-files';
import type { ChatFileOpening, ChatFileSource } from './use-chat-file-opening';

export function ChatFileOpened({ source, opening }: { source: ChatFileSource; opening: ChatFileOpening }): JSX.Element | null {
  if (opening.openedIn === null || source.read === null || source.download === null) return null;
  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) opening.close(); }}>
      <DialogContent className="flex h-[90dvh] max-w-[1100px] flex-col gap-0 overflow-hidden p-0" aria-describedby={undefined} data-testid="chat-file-opened" data-app={opening.openedIn}>
        <DialogTitle className="truncate border-b border-border px-[16px] py-[12px] pr-[48px] text-sm font-semibold">{source.name}</DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col">
          <DocsFileView
            fileId={source.fileId} original={{ name: source.name, download: source.download }} mime={source.mime}
            read={source.read} loadCdocRuntime={loadCdocRuntime} files={browserDocumentFiles}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
