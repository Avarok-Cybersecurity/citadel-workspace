/**
 * The screen a changed peer key raises: the key the person had, the new one, and an explicit
 * choice. Accept is the only way the new key is pinned, and it pins exactly the key shown here.
 * Cancel (or Escape) leaves the peer refused; the header's "Key changed" mark reopens this.
 */
import { useState } from 'react';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { IDENTITY_COPY } from '@/lib/peer-identity/identity-copy';
import { Fingerprint } from './Fingerprint';

interface PeerKeyChangedDialogProps {
  open: boolean;
  peerName: string;
  previous: string;
  presented: string;
  /** Pins `presented`; rejects with the agent's reason. */
  onAccept: (fingerprint: string) => Promise<void>;
  onCancel: () => void;
}

export function PeerKeyChangedDialog({ open, peerName, previous, presented, onAccept, onCancel }: PeerKeyChangedDialogProps): JSX.Element {
  const [busy, setBusy] = useState<boolean>(false);
  const [failure, setFailure] = useState<string | null>(null);
  const accept = (): void => {
    setBusy(true);
    setFailure(null);
    onAccept(presented).then(
      (): void => setBusy(false),
      (err: unknown): void => {
        setBusy(false);
        setFailure(`${IDENTITY_COPY.acceptFailed}: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  };
  return (
    <AlertDialog open={open} onOpenChange={(next: boolean): void => { if (!next && !busy) onCancel(); }}>
      <AlertDialogContent data-testid="peer-key-changed">
        <AlertDialogHeader>
          <AlertDialogTitle>{IDENTITY_COPY.changedTitle(peerName)}</AlertDialogTitle>
          <AlertDialogDescription>{IDENTITY_COPY.changedBody(peerName)}</AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="space-y-3">
          <Fingerprint label={IDENTITY_COPY.previousKey} value={previous} testId="peer-key-previous" />
          <Fingerprint label={IDENTITY_COPY.newKey} value={presented} testId="peer-key-presented" />
        </dl>
        <p role="alert" className="min-h-[1.25rem] text-sm text-destructive-emphasis">{failure}</p>
        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" className="min-h-[44px]" disabled={busy} onClick={onCancel}>{IDENTITY_COPY.cancel}</Button>
          <Button className="min-h-[44px]" disabled={busy} aria-busy={busy} onClick={accept} data-testid="peer-key-accept">
            {IDENTITY_COPY.accept}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
