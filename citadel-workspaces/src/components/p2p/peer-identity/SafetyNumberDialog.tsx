/**
 * The pair's safety number: both fingerprints in one fixed order, so the two people read the
 * same lines. Says plainly why there is none for a conversation that cannot be verified.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IDENTITY_COPY } from '@/lib/peer-identity/identity-copy';
import { safetyNumberOf, type PeerIdentityView } from '@/lib/peer-identity/wire';
import { Fingerprint } from './Fingerprint';

interface SafetyNumberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerName: string;
  view: PeerIdentityView;
}

export function SafetyNumberDialog({ open, onOpenChange, peerName, view }: SafetyNumberDialogProps): JSX.Element {
  const lines: readonly [string, string] | null = safetyNumberOf(view);
  const why: string = view.own === null ? IDENTITY_COPY.noOwnKey : IDENTITY_COPY.noPeerKey(peerName);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="peer-safety-number">
        <DialogHeader>
          <DialogTitle>{IDENTITY_COPY.safetyTitle(peerName)}</DialogTitle>
          <DialogDescription>{lines === null ? why : IDENTITY_COPY.safetyHowTo(peerName)}</DialogDescription>
        </DialogHeader>
        {lines !== null && (
          <dl className="space-y-3">
            <Fingerprint label="1" value={lines[0]} testId="safety-number-line" />
            <Fingerprint label="2" value={lines[1]} testId="safety-number-line" />
          </dl>
        )}
        {lines !== null && view.own !== null && view.pinned !== null && (
          <dl className="space-y-3 border-t border-surface pt-3">
            <Fingerprint label={IDENTITY_COPY.yourKey} value={view.own} testId="safety-number-own" />
            <Fingerprint label={IDENTITY_COPY.theirKey(peerName)} value={view.pinned} testId="safety-number-peer" />
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
