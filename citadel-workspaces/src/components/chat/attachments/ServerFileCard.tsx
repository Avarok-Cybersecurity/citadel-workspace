/**
 * A file shared in a node's chat, as its bubble shows it: the picture itself when its bytes are
 * one, otherwise the type's icon, then the name, size and where it is kept, and a Download that
 * saves the original bytes under the sender's name, sanitised.
 */
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format-bytes';
import { getFileIcon } from '@/components/p2p/bubbles/file-transfer-helpers';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import { useSharedFile, type SharedFileView } from './use-shared-file';

export function ServerFileCard({ file }: { file: SharedFile }): JSX.Element {
  const view: SharedFileView = useSharedFile(file);
  return (
    <div data-testid="server-file" className="min-w-0">
      {view.pictureUrl !== null && (
        <img
          src={view.pictureUrl}
          alt={file.name}
          data-testid="server-file-picture"
          className="mb-2 block max-h-[240px] max-w-full rounded-md object-contain"
        />
      )}
      <div className="flex items-center gap-2">
        {view.pictureUrl === null && <span aria-hidden="true" className="shrink-0">{getFileIcon(file.mime)}</span>}
        <div className="min-w-0 flex-1">
          <p className="font-medium break-all">{file.name}</p>
          <p className="text-xs opacity-80">{formatBytes(file.size)} · on the workspace server</p>
        </div>
        {view.download !== null && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={view.download}
            disabled={view.busy}
            aria-label={`Download ${file.name}`}
            data-testid="server-file-download"
            className="h-[44px] w-[44px] shrink-0"
          >
            {view.busy ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Download className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {view.failure !== null && <p role="alert" className="mt-1 text-xs text-destructive">{view.failure}</p>}
    </div>
  );
}
