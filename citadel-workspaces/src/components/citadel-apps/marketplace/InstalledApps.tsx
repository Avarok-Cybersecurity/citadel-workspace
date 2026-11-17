/**
 * The Apps section: what is installed for you, and what you can do about each -- turn it off for
 * yourself, look for an update, uninstall (yours, or anyone's with "Manage installed apps"), and
 * answer its direct connections for yourself. An install waiting for consent says what it waits for.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AppInstall, ListingOffer } from 'citadel-workspace-client-ts';
import { Permission } from '@/lib/permissions-service/types';
import { findListedApp, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { scopeSentence } from '@/lib/citadel-apps/scope-sentence';
import { updateOffer } from '@/lib/citadel-apps/listing-offer';
import { refusalCopy } from '@/lib/citadel-apps/refusal-copy';
import { checkForUpdate, setDisabledForMe, uninstallApp, type AppsResult, type UpdateOutcome } from '@/lib/workspace-service/apps-operations';
import { recordDisabledForMe, useDisabledForMe } from '@/lib/citadel-apps/disabled-for-me';
import { InstalledPeerConsent } from './InstalledPeerConsent';
import { UninstallConfirm } from './UninstallConfirm';
import type { MarketplaceDeps, MarketplaceViewer } from './marketplace-types';

interface InstalledAppsProps {
  installs: readonly AppInstall[];
  apps: readonly ListedApp[];
  deps: MarketplaceDeps;
  viewer: MarketplaceViewer;
  onChanged: (install: AppInstall) => void;
  onRemoved: (installId: string) => void;
}

export function stateCopy(install: AppInstall, name: string): string | null {
  const s: AppInstall['state'] = install.state;
  if (s === 'Active') return null;
  if ('NeedsConsent' in s) {
    return s.NeedsConsent.reason === 'PublisherKeyChanged'
      ? `${name} ${s.NeedsConsent.version} is signed with a different key; waiting for an admin.`
      : `${name} ${s.NeedsConsent.version} needs a new permission; waiting for an admin.`;
  }
  return `Turned off by an admin: ${s.Suspended.reason}`;
}

export function InstalledApps({ installs, apps, deps, viewer, onChanged, onRemoved }: InstalledAppsProps): JSX.Element {
  const disabled: ReadonlySet<string> = useDisabledForMe();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const note = (id: string, text: string): void => setNotes((n: Record<string, string>) => ({ ...n, [id]: text }));
  const manage: boolean = viewer.authority.holds(Permission.AppManage, viewer.rootId) === 'yes';

  const run = async <T,>(id: string, work: () => Promise<AppsResult<T>>, then: (value: T) => void): Promise<void> => {
    setBusy(id);
    const result: AppsResult<T> = await work();
    setBusy(null);
    if (result.ok) then(result.value); else note(id, refusalCopy(result.refusal));
  };

  const updateOf = (install: AppInstall): Promise<AppsResult<UpdateOutcome>> => {
    const offer: ListingOffer | null = updateOffer(install, apps);
    return offer === null ? Promise.resolve({ ok: false, refusal: 'Unavailable' }) : checkForUpdate(deps.transport, install.id, offer);
  };

  if (installs.length === 0) return <p className="py-[32px] text-sm text-muted-foreground" data-testid="apps-installed-empty">No apps are installed for you yet.</p>;

  return (
    <ul className="flex flex-col gap-[12px]" data-testid="apps-installed">
      {installs.map((install: AppInstall) => {
        const name: string = findListedApp(apps, install.app_id)?.manifest.name ?? install.app_id;
        const off: boolean = disabled.has(install.id);
        const waiting: string | null = stateCopy(install, name);
        const mayRemove: boolean = install.installed_by === viewer.me || manage;
        return (
          <li key={install.id} className="flex flex-col gap-[8px] rounded-lg border border-border p-[12px]" data-testid="apps-installed-row" data-install-id={install.id}>
            <div className="flex flex-col">
              <span className="break-words font-medium text-foreground">{name} {install.version}</span>
              <span className="break-words text-xs text-muted-foreground">For: {scopeSentence(install.scope, viewer.reach(install.scope), viewer.nodeName)}</span>
              {waiting !== null && <span className="break-words text-sm text-warning-emphasis" data-testid="apps-installed-state">{waiting}</span>}
              {off && <span className="text-sm text-muted-foreground">Turned off for you</span>}
              {notes[install.id] !== undefined && <span role="status" className="break-words text-sm text-foreground" data-testid="apps-installed-note">{notes[install.id]}</span>}
            </div>
            {confirming === install.id ? (
              <UninstallConfirm appName={name} busy={busy === install.id} onCancel={() => setConfirming(null)}
                onConfirm={(purge: boolean) => { void run(install.id, () => uninstallApp(deps.transport, install.id, purge), (id: string) => { setConfirming(null); onRemoved(id); }); }} />
            ) : (
              <div className="flex flex-wrap gap-[8px]">
                <Button variant="outline" className="min-h-[44px]" disabled={busy === install.id} data-testid="apps-installed-toggle"
                  onClick={() => { void run(install.id, () => setDisabledForMe(deps.transport, install.id, !off), (now: boolean) => recordDisabledForMe(install.id, now)); }}>
                  {off ? 'Turn on for me' : 'Turn off for me'}
                </Button>
                <Button variant="outline" className="min-h-[44px]" disabled={busy === install.id} data-testid="apps-installed-update"
                  onClick={() => { void run(install.id, () => updateOf(install), (u: UpdateOutcome) => { if (u.kind === 'updated') onChanged(u.install); note(install.id, u.kind === 'updated' ? `Updated to ${u.install.version}.` : 'Up to date.'); }); }}>
                  Check for updates
                </Button>
                <Button variant="outline" className="min-h-[44px]" disabled={!mayRemove || busy === install.id} onClick={() => setConfirming(install.id)} data-testid="apps-installed-uninstall">
                  Uninstall
                </Button>
                {!mayRemove && <p className="w-full text-xs text-muted-foreground">Only the person who installed it, or an admin, can uninstall it.</p>}
                <InstalledPeerConsent install={install} appName={name} transport={deps.transport} onNote={(text: string) => note(install.id, text)} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
