/**
 * "Verified", "Unverified" or "Key changed", beside the peer's status in the chat header, and
 * the dialogs it opens: the safety number, or the changed-key screen. A changed key raises its
 * screen on its own the first time it is seen; after Cancel the mark reopens it.
 *
 * Nothing shows while the agent has not answered, or could not: a mark is a claim.
 */
import { useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { IDENTITY_COPY, identityMarkOf, type IdentityMarkKind } from '@/lib/peer-identity/identity-copy';
import type { PeerIdentityView } from '@/lib/peer-identity/wire';
import { SafetyNumberDialog } from './SafetyNumberDialog';
import { PeerKeyChangedDialog } from './PeerKeyChangedDialog';

interface PeerIdentityMarkProps {
  peerName: string;
  view: PeerIdentityView | null;
  /** Pins the shown key, then redials; rejects with the agent's reason. */
  onAccept: (fingerprint: string) => Promise<void>;
}

const TONE: Readonly<Record<IdentityMarkKind, string>> = {
  verified: 'bg-success/20 text-success-emphasis',
  unverified: 'bg-surface text-muted-foreground',
  changed: 'bg-warning/20 text-warning-emphasis',
};

const ICON: Readonly<Record<IdentityMarkKind, typeof ShieldCheck>> = {
  verified: ShieldCheck,
  unverified: ShieldQuestion,
  changed: ShieldAlert,
};

export function PeerIdentityMark({ peerName, view, onAccept }: PeerIdentityMarkProps): JSX.Element | null {
  const [safetyOpen, setSafetyOpen] = useState<boolean>(false);
  // The waiting key whose screen the person closed: a different key raises it again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [changedOpen, setChangedOpen] = useState<boolean>(false);
  const pending: string | null = view?.pending ?? null;
  useEffect(() => { setChangedOpen(pending !== null && pending !== dismissed); }, [pending, dismissed]);

  if (view === null) return null;
  const kind: IdentityMarkKind = identityMarkOf(view);
  const Icon: typeof ShieldCheck = ICON[kind];
  const open = (): void => { if (kind === 'changed') setChangedOpen(true); else setSafetyOpen(true); };
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={`${IDENTITY_COPY.mark[kind]}: ${IDENTITY_COPY.markHint[kind]}`}
        title={IDENTITY_COPY.markHint[kind]}
        data-testid="peer-identity-mark"
        data-kind={kind}
        className={`inline-flex min-h-[24px] items-center gap-1 rounded-full px-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${TONE[kind]}`}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        {IDENTITY_COPY.mark[kind]}
      </button>
      <SafetyNumberDialog open={safetyOpen} onOpenChange={setSafetyOpen} peerName={peerName} view={view} />
      {pending !== null && view.pinned !== null && (
        <PeerKeyChangedDialog
          open={changedOpen}
          peerName={peerName}
          previous={view.pinned}
          presented={pending}
          onAccept={async (fingerprint: string): Promise<void> => { await onAccept(fingerprint); setChangedOpen(false); }}
          onCancel={(): void => { setDismissed(pending); setChangedOpen(false); }}
        />
      )}
    </>
  );
}
