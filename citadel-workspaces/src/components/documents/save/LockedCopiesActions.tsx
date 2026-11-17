/**
 * What a person can do when copies of the document kept on this device are locked: take the
 * document from the server again ("Sync from server", while the link is up), or remove them
 * ("Discard"). Both remove the locked copies, and neither does it before an explicit yes that
 * says when edits never sent are among them. Nothing is removed silently.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LOCKED_DISCARD, LOCKED_ON_DEVICE, LOCKED_SYNC_FROM_SERVER, lockedRemovalQuestion } from '@/lib/at-rest/at-rest-copy';
import type { SaveControl } from './save-control';

type Asking = { readonly action: string; readonly unsentEdits: boolean } | null;

const button: string = 'min-h-[44px] rounded-md border border-border px-[12px] text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

export function LockedCopiesActions({ control, linkUp }: { readonly control: SaveControl; readonly linkUp: boolean }): JSX.Element {
  const [asking, setAsking] = useState<Asking>(null);
  const ask = (action: string): void => {
    control.lockedCopiesHoldEdits().then(
      (unsentEdits: boolean): void => setAsking({ action, unsentEdits }),
      (error: unknown): void => { toast.error(`Could not check the copies on this device. ${error instanceof Error ? error.message : String(error)}`); },
    );
  };
  const remove = (): void => {
    setAsking(null);
    control.removeLockedCopies().catch((error: unknown): void => { toast.error(`The locked copies were not removed. ${error instanceof Error ? error.message : String(error)}`); });
  };
  return (
    <>
      <button type="button" data-testid="docs-locked-sync" disabled={!linkUp} onClick={(): void => ask(LOCKED_SYNC_FROM_SERVER)} className={button}>{LOCKED_SYNC_FROM_SERVER}</button>
      <button type="button" data-testid="docs-locked-discard" onClick={(): void => ask(LOCKED_DISCARD)} className={button}>{LOCKED_DISCARD}</button>
      <AlertDialog open={asking !== null} onOpenChange={(open: boolean): void => { if (!open) setAsking(null); }}>
        <AlertDialogContent data-testid="docs-locked-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{LOCKED_ON_DEVICE}</AlertDialogTitle>
            <AlertDialogDescription>{lockedRemovalQuestion('this document', asking?.unsentEdits ?? false)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction data-testid="docs-locked-confirm-remove" onClick={remove}>{asking?.action ?? LOCKED_DISCARD}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
