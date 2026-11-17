/**
 * The three ways a folder can show nothing, each said as itself:
 *
 * - it is empty: a dashed panel, a folder glyph, one line, Upload files;
 * - the filter matched nothing: "No matches", and a way to clear it -- saying
 *   "empty" here told people their files were gone;
 * - it is not there: renamed or deleted elsewhere, or a link to a folder that
 *   does not exist. Dropping files into it would go nowhere.
 */
import { FolderOpen, FolderX, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RECEIVED_FILES_DIR, SENT_FILES_DIR } from '@/types/revfs-types';
import type { UploadAvailability } from './upload-refusal';

const PANEL: string = 'flex flex-1 flex-col items-center justify-center gap-[10px] rounded-[6px] border border-dashed border-border px-[16px] py-[32px] text-center';
const GLYPH: string = 'mb-[4px] grid h-[52px] w-[52px] place-items-center rounded-[10px] bg-surface text-muted-foreground';

function guidance(folder: string): string {
  if (folder === SENT_FILES_DIR) return 'Files you send to workspace members appear here.';
  if (folder === RECEIVED_FILES_DIR) return 'Files workspace members send you appear here.';
  return 'Drag files anywhere in this panel to upload them here.';
}

export function VFSEmptyFolder({ folder, upload, onUpload }: {
  folder: string; upload: UploadAvailability; onUpload: () => void;
}): JSX.Element {
  return (
    <div className={PANEL}>
      <span className={GLYPH}><FolderOpen className="h-[22px] w-[22px]" aria-hidden="true" /></span>
      <p className="text-base font-semibold text-foreground">This folder is empty</p>
      <p className="max-w-[360px] text-sm text-muted-foreground">{upload.kind === 'offered' ? guidance(folder) : upload.reason}</p>
      {upload.kind === 'offered' && (
        <Button variant="outline" size="sm" className="mt-[4px] h-[32px]" onClick={onUpload}>Upload files</Button>
      )}
    </div>
  );
}

export function VFSNoMatches({ filterText, onClearFilter }: { filterText: string; onClearFilter: () => void }): JSX.Element {
  return (
    <div className={PANEL}>
      <span className={GLYPH}><SearchX className="h-[22px] w-[22px]" aria-hidden="true" /></span>
      <p className="text-base font-semibold text-foreground">No matches</p>
      <p className="max-w-[360px] break-words text-sm text-muted-foreground">Nothing in this folder matches &ldquo;{filterText}&rdquo;.</p>
      <Button variant="outline" size="sm" className="mt-[4px] h-[32px]" onClick={onClearFilter}>Clear filter</Button>
    </div>
  );
}

export function VFSFolderNotFound({ path, storageName, onTop }: { path: string; storageName: string; onTop: () => void }): JSX.Element {
  return (
    <div className={PANEL} data-testid="vfs-folder-gone" role="status">
      <span className={GLYPH}><FolderX className="h-[22px] w-[22px]" aria-hidden="true" /></span>
      <p className="text-base font-semibold text-foreground">Folder not found</p>
      <p className="max-w-[420px] break-words text-sm text-muted-foreground">
        There is no folder at <span className="font-mono">{path}</span> in {storageName}. It may have been renamed or deleted.
      </p>
      <Button variant="outline" size="sm" className="mt-[4px] h-[32px]" onClick={onTop}>Go to the top level</Button>
    </div>
  );
}
