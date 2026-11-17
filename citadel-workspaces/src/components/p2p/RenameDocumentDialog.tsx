import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DOC_TITLE_MAX_LENGTH, validateDocTitle, type TitleCheck } from '@/lib/live-document-store/doc-title';

interface RenameDocumentDialogProps {
  open: boolean;
  currentTitle: string;
  /** Resolves when the rename is applied; a rejection's message is shown in the dialog. */
  onRename: (title: string) => Promise<void>;
  onClose: () => void;
}

/** One rename form for every entry point: the tab's context menu, F2, and the header pencil. */
export function RenameDocumentDialog({ open, currentTitle, onRename, onClose }: RenameDocumentDialogProps): JSX.Element {
  const [value, setValue] = useState<string>(currentTitle);
  const [touched, setTouched] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const invoker: MutableRefObject<HTMLElement | null> = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) { setValue(currentTitle); setTouched(false); setFailure(null); }
  }, [open, currentTitle]);

  const check: TitleCheck = validateDocTitle(value);
  const problem: string | null = failure ?? (touched && !check.ok ? check.reason : null);
  const unchanged: boolean = check.ok && check.title === currentTitle;

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (!check.ok || busy) return;
    if (unchanged) { onClose(); return; }
    setBusy(true);
    setFailure(null);
    try {
      await onRename(check.title);
      setAnnouncement(`Document renamed to ${check.title}`);
      onClose();
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : 'Could not rename the document.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    {/* Present before it is written, so the rename is announced after the dialog is gone. */}
    <span className="sr-only" role="status">{announcement}</span>
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="rename-document-dialog"
        // Focus goes back to whatever opened the dialog (tab, F2 target or pencil),
        // not to <body>: Radix only restores to a trigger it owns.
        onOpenAutoFocus={() => { invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(e) => { if (invoker.current?.isConnected) { e.preventDefault(); invoker.current.focus(); } }}
      >
        <DialogHeader>
          <DialogTitle>Rename document</DialogTitle>
          <DialogDescription>Everyone editing this document sees the new title.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-2" noValidate>
          <label htmlFor="rename-document-input" className="text-sm text-muted-foreground">Title</label>
          <Input
            id="rename-document-input"
            data-testid="rename-document-input"
            value={value}
            onChange={(e) => { setValue(e.target.value); setTouched(true); setFailure(null); }}
            aria-invalid={problem ? true : undefined}
            className={problem ? 'border-destructive-emphasis' : undefined}
            aria-describedby={problem ? 'rename-document-problem' : undefined}
            maxLength={DOC_TITLE_MAX_LENGTH * 2}
          />
          <div className="flex items-start justify-between gap-3 min-h-5 text-xs">
            <p id="rename-document-problem" role={problem ? 'alert' : undefined} className="text-destructive-emphasis">
              {problem}
            </p>
            <span className="shrink-0 text-muted-foreground tabular-nums" aria-hidden="true">
              {value.trim().length}/{DOC_TITLE_MAX_LENGTH}
            </span>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" data-testid="rename-document-confirm" disabled={busy}>
              {busy ? 'Renaming…' : 'Rename'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
