/**
 * The install consent screen (design 2.4): one scrollable panel, not a wizard. The app, its
 * version and publisher with the key's fingerprint and whether this key is new to you; who it is
 * being installed for; every permission it asks for; what it can never do; the artifact's hash.
 * Install enables only after the panel has been on screen 600 ms and the pointer has moved
 * (use-consent-gate.ts), and never while a required permission cannot be granted.
 */
import { useEffect, useState } from 'react';
import type { Clock } from '@/lib/cdoc/collab/ports';
import { Button } from '@/components/ui/button';
import type { Capability } from 'citadel-workspace-client-ts';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import { canNever, keyTrustCopy, type ConsentRow, type KeyTrust } from '@/lib/citadel-apps/consent-model';
import { publisherFingerprint } from '@/lib/citadel-apps/fingerprint';
import { AppIconImage } from './AppIconImage';
import { CapabilityRows } from './CapabilityRows';
import { useConsentGate } from './use-consent-gate';

interface ConsentPanelProps {
  app: ListedApp;
  scopeSentence: string;
  rows: readonly ConsentRow[];
  onToggle: (cap: Capability, on: boolean) => void;
  trust: KeyTrust;
  /** Why Install cannot be pressed whatever the person does; null when it can. */
  problem: string | null;
  onInstall: () => void;
  onBack: () => void;
  /** What the 600 ms guard runs on. */
  clock: Clock;
}

function useFingerprint(key: string): string | null {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    let live: boolean = true;
    void publisherFingerprint(key).then((f: string | null) => { if (live) setShown(f); });
    return (): void => { live = false; };
  }, [key]);
  return shown;
}

export function ConsentPanel({ app, scopeSentence, rows, onToggle, trust, problem, onInstall, onBack, clock }: ConsentPanelProps): JSX.Element {
  const m: ListedApp['manifest'] = app.manifest;
  const fingerprint: string | null = useFingerprint(m.publisher.mldsa65_public_key);
  const gateOpen: boolean = useConsentGate(clock);
  return (
    <section className="flex flex-col gap-[16px]" data-testid="apps-consent" aria-labelledby="apps-consent-title">
      <header className="flex items-start gap-[12px]">
        <AppIconImage icon={m.icon} size={48} />
        <div className="flex min-w-0 flex-col gap-[2px]">
          <h3 id="apps-consent-title" className="break-words text-lg font-semibold text-foreground">Install {m.name} {m.version}?</h3>
          <p className="break-words text-sm text-muted-foreground">Published by {m.publisher.name}</p>
          <p className="text-sm text-foreground">
            Key fingerprint <span className="font-mono" data-testid="apps-consent-fingerprint">{fingerprint ?? '…'}</span>
          </p>
          <p className="text-sm text-muted-foreground" data-testid="apps-consent-trust">{keyTrustCopy(trust)}</p>
        </div>
      </header>
      <p className="break-words rounded-md bg-muted/50 p-[12px] text-sm text-foreground" data-testid="apps-consent-scope">{scopeSentence}</p>
      <div className="flex flex-col gap-[8px]">
        <h4 className="text-sm font-medium text-foreground">It will be able to</h4>
        <CapabilityRows rows={rows} onToggle={onToggle} />
      </div>
      <div className="flex flex-col gap-[6px]">
        <h4 className="text-sm font-medium text-foreground">This app can never:</h4>
        <ul className="flex list-disc flex-col gap-[2px] pl-[20px] text-sm text-foreground/80" data-testid="apps-consent-never">
          {canNever(rows).map((line: string) => <li key={line} className="break-words">{line}</li>)}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        App file hash (sha256): <span className="break-all font-mono" data-testid="apps-consent-hash">{m.artifact.sha256}</span>
      </p>
      <p className="text-xs text-muted-foreground">The workspace server checks the publisher’s signature and this hash before it installs anything.</p>
      {problem !== null && <p role="alert" className="break-words text-sm text-destructive-emphasis" data-testid="apps-consent-problem">{problem}</p>}
      <div className="flex flex-wrap gap-[8px]">
        <Button variant="outline" className="min-h-[44px]" onClick={onBack}>Back</Button>
        <Button className="min-h-[44px]" onClick={onInstall} disabled={!gateOpen || problem !== null} data-testid="apps-consent-install">
          Install
        </Button>
      </div>
    </section>
  );
}
