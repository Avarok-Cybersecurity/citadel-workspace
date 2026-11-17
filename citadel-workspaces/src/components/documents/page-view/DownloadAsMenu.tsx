/**
 * "Download as…" on an open document: one entry per format the engine writes, each a 44 px
 * target, reachable by keyboard (the trigger is a button; the menu is Radix's, arrow keys and
 * Enter) and by touch. While a download is being written the trigger says so and its entries
 * wait; the trigger stays focusable (aria-disabled, not disabled) so focus returns to it. The
 * menu is not modal: the document beside it is never hidden from assistive tech while it is open.
 */
import { Download } from 'lucide-react';
import { DOCS_EXPORT_FORMATS, DOCS_FORMATS } from '@/lib/citadel-apps/docs-file-kinds';
import type { ExportFormat } from '@/lib/cdoc/editor/file-formats';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { ExportState } from './useDocsExport';

interface DownloadAsMenuProps {
  readonly state: ExportState;
  readonly onExport: (format: ExportFormat) => void;
}

/** The trigger's look, shared with the placeholder shown while the document opens. */
export const DOWNLOAD_AS_TRIGGER: string = 'inline-flex min-h-[44px] items-center gap-[8px] rounded px-[12px] text-sm text-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-60';

export function DownloadAsMenu({ state, onExport }: DownloadAsMenuProps): JSX.Element {
  const busy: boolean = state.kind === 'exporting';
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-disabled={busy}
        data-testid="docs-download-as"
        className={DOWNLOAD_AS_TRIGGER}
      >
        <Download className="h-[16px] w-[16px]" aria-hidden="true" />
        {state.kind === 'exporting' ? `Preparing .${DOCS_FORMATS[state.format].extension}…` : 'Download as…'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {DOCS_EXPORT_FORMATS.map((format: ExportFormat) => (
          <DropdownMenuItem key={format} data-testid={`docs-download-as-${format}`} className="min-h-[44px]" disabled={busy} onSelect={() => onExport(format)}>
            {DOCS_FORMATS[format].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
