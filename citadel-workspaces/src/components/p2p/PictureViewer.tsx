/**
 * The full-size picture viewer: fit to the screen or zoomed, previous and next through the
 * conversation's pictures, Download under the original name, and open in a new tab. Radix's
 * Dialog traps focus and closes on Esc; the arrows, + - and 0 are answered here (viewer-state.ts).
 *
 * Only a ShownPicture (bytes checked as a raster image, typed by what they are) is downloaded or
 * opened in a tab. A sender's thumbnail shown after a reload is shown, not offered as the file.
 */
import { useReducer } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/document-files';
import { safeDownloadName } from '@/lib/received-files/download-name';
import { safeThumbnail } from '@/lib/received-files/image-preview';
import { actionForKey, step, type ViewerAction, type ViewerState } from '@/lib/received-files/viewer-state';
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { PictureLoad } from '@/lib/received-files/picture-load';
import { useTransferPicture } from './hooks/useTransferPicture';

interface PictureViewerProps {
  readonly pictures: readonly FileTransfer[];
  readonly startIndex: number;
  readonly onClose: () => void;
}

const TOOL: string = 'min-h-11 min-w-11';

export function PictureViewer({ pictures, startIndex, onClose }: PictureViewerProps): JSX.Element {
  const [view, act] = useReducer((s: ViewerState, a: ViewerAction): ViewerState => step(s, a, pictures.length), { index: startIndex, zoom: null });
  const current: FileTransfer = pictures[view.index];
  const load: PictureLoad | null = useTransferPicture(current);
  const shown: { url: string; blob: Blob; width: number } | null = load !== null && 'url' in load ? { url: load.url, blob: load.blob, width: load.picture.size.width } : null;
  const src: string | null = shown?.url ?? safeThumbnail(current.thumbnail);
  const name: string = safeDownloadName(current.fileName);
  const many: boolean = pictures.length > 1;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const action: ViewerAction | null = actionForKey(event.key);
    if (action === null) return;
    event.preventDefault();
    act(action);
  };

  return (
    <Dialog open onOpenChange={(open: boolean): void => { if (!open) onClose(); }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="picture-viewer"
        className="max-w-[min(calc(100vw-2rem),72rem)] gap-3 bg-card p-3 sm:p-4 text-foreground">
        <div className="flex min-w-0 items-center gap-2 pr-12">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">{current.fileName}</DialogTitle>
          {many && <span className="text-xs text-muted-foreground" aria-live="polite">{view.index + 1} of {pictures.length}</span>}
        </div>
        <DialogDescription className="sr-only">
          Full-size picture. Arrow keys move between pictures, plus and minus zoom, 0 fits it to the screen.
        </DialogDescription>
        <div className="relative flex h-[min(70dvh,48rem)] items-center justify-center overflow-auto rounded-md bg-background/70" data-testid="picture-viewer-stage">
          {src !== null ? (
            <img src={src} alt={current.fileName} draggable={false} data-testid="picture-viewer-image"
              className={view.zoom === null ? 'max-h-full max-w-full object-contain' : 'max-w-none'}
              style={view.zoom === null || shown === null ? undefined : { width: `${shown.width * view.zoom}px` }} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">{load !== null && 'unavailable' in load ? `This picture cannot be shown: ${load.unavailable}.` : 'Loading picture...'}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2" role="toolbar" aria-label="Picture controls">
          <div className="flex items-center gap-1">
            {many && <Button variant="ghost" size="icon" className={TOOL} aria-label="Previous picture" disabled={view.index === 0} onClick={(): void => act('previous')}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Button>}
            {many && <Button variant="ghost" size="icon" className={TOOL} aria-label="Next picture" disabled={view.index === pictures.length - 1} onClick={(): void => act('next')}><ChevronRight className="h-5 w-5" aria-hidden="true" /></Button>}
            <Button variant="ghost" size="icon" className={TOOL} aria-label="Zoom out" disabled={view.zoom === null || shown === null} onClick={(): void => act('zoom-out')}><ZoomOut className="h-5 w-5" aria-hidden="true" /></Button>
            <Button variant="ghost" className={`${TOOL} px-2 text-xs tabular-nums`} aria-label="Fit to screen" disabled={shown === null} onClick={(): void => act('fit')}>
              {view.zoom === null ? <Maximize className="h-5 w-5" aria-hidden="true" /> : `${Math.round(view.zoom * 100)}%`}
            </Button>
            <Button variant="ghost" size="icon" className={TOOL} aria-label="Zoom in" disabled={shown === null} onClick={(): void => act('zoom-in')}><ZoomIn className="h-5 w-5" aria-hidden="true" /></Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className={TOOL} disabled={shown === null} aria-label={`Open ${current.fileName} in a new tab`}
              onClick={(): void => { if (shown) window.open(shown.url, '_blank', 'noopener,noreferrer'); }}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Open</span>
            </Button>
            <Button className={TOOL} disabled={shown === null} data-testid="picture-viewer-download"
              onClick={(): void => { if (shown) downloadBlob(shown.blob, name); }}>
              <Download className="h-4 w-4" aria-hidden="true" />Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
