/**
 * One installed app's direct-connection answers for this member, behind a disclosure button: shown
 * only when the install was granted a P2P or topic capability. Each choice goes to the server
 * (SetPeerConsentForMe, SetPeerBlockedForMe) and the tab's copy changes only on its answer.
 */
import { useEffect, useState } from 'react';
import type { AppInstall, PeerForMe } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { consentWith, memberAsks, type MemberAsk } from '@/lib/citadel-apps/consent-model';
import type { ConsentPlane } from '@/lib/citadel-apps/member-consent-types';
import { markPeerAnswering } from '@/lib/citadel-apps/peer-answering';
import { recordPeerBlocked, recordPeerConsent, usePeerForMe } from '@/lib/citadel-apps/peer-for-me';
import { refusalCopy } from '@/lib/citadel-apps/refusal-copy';
import type { AppsResult, AppsTransport } from '@/lib/workspace-service/apps-operations';
import { setPeerBlockedForMe, setPeerConsentForMe } from '@/lib/workspace-service/apps-peer-operations';
import { PeerConsentPanel } from './PeerConsentPanel';

interface InstalledPeerConsentProps {
  install: AppInstall;
  appName: string;
  transport: AppsTransport;
  onNote: (text: string) => void;
}

export function InstalledPeerConsent({ install, appName, transport, onNote }: InstalledPeerConsentProps): JSX.Element | null {
  const mine: PeerForMe | undefined = usePeerForMe().get(install.id);
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const asks: MemberAsk[] = memberAsks(install.granted, mine?.consent ?? null);
  // While the answers are open they are still arriving, one plane at a time (peer-answering.ts).
  useEffect(() => {
    if (!open) return undefined;
    markPeerAnswering(install.id, true);
    return (): void => markPeerAnswering(install.id, false);
  }, [open, install.id]);
  if (asks.length === 0) return null;

  const run = async <T,>(work: () => Promise<AppsResult<T>>, then: (value: T) => void): Promise<void> => {
    setBusy(true);
    const r: AppsResult<T> = await work();
    setBusy(false);
    if (r.ok) then(r.value); else onNote(refusalCopy(r.refusal));
  };
  const onSet = (plane: ConsentPlane, allowed: boolean): void => {
    void run(() => setPeerConsentForMe(transport, install.id, consentWith(mine?.consent ?? null, plane, allowed)), (c) => recordPeerConsent(install.id, c));
  };
  const onBlock = (username: string, block: boolean): void => {
    void run(() => setPeerBlockedForMe(transport, install.id, username, block), (now: boolean) => recordPeerBlocked(install.id, username, now));
  };

  return (
    <>
      <Button variant="outline" className="min-h-[44px]" aria-expanded={open} onClick={() => setOpen((o: boolean) => !o)} data-testid="apps-installed-peer-toggle">
        {open ? 'Hide direct connections' : 'Direct connections'}
      </Button>
      {open && <div className="w-full"><PeerConsentPanel appName={appName} asks={asks} blocked={mine?.blocked ?? []} busy={busy} onSet={onSet} onBlock={onBlock} /></div>}
    </>
  );
}
