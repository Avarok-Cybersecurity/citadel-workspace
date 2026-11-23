/**
 * The placeholder an app zone draws instead of its app (design 2.6): a bordered panel of the
 * zone's height saying what the zone needs and the one thing this person can do about it. An app
 * outside your audience reads exactly like one that does not exist, and shows no icon of its own.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { versionFloorLabel, type AppVersion } from '@/lib/citadel-apps/app-identity';
import { AppIconImage } from '@/components/citadel-apps/marketplace/AppIconImage';
import type { ZoneView } from './zone-state';
import type { Placement } from '@/lib/citadel-apps/runtime/placement';

export type PlaceholderView = Exclude<ZoneView, { kind: 'ready' }> | { kind: 'ready-unmounted'; name: string };

interface AppZoneRequiredProps {
  /** Where the app would run: a zone in a page, a tab of the node's pane, or the node's page itself. */
  placement: Placement['kind'];
  appId: string;
  floor: AppVersion | null;
  height: number;
  view: PlaceholderView;
  icon: Parameters<typeof AppIconImage>[0]['icon'];
  onInstall: () => void;
  onEnable: () => void;
  onCopyLink: () => Promise<void>;
  onOpenApps: () => void;
}

/** How each placement is named: "This zone", "This tab", "This page"; "cannot be shown in a page zone". */
const NOUN: Readonly<Record<Placement['kind'], string>> = { zone: 'zone', tab: 'tab', page: 'page' };
const GROUP_LABEL: Readonly<Record<Placement['kind'], string>> = { zone: 'App zone', tab: 'App tab', page: 'App page' };
const RUNS: Readonly<Record<Placement['kind'], string>> = { zone: 'on pages', tab: 'in tabs', page: 'as pages' };

function wrongSurface(placement: Placement['kind'], name: string): [string, string] {
  if (placement === 'page') return [`${name} can no longer be shown as a page.`, 'The release installed here does not offer a page. A workspace admin can install one that does, or move this node’s content elsewhere.'];
  return [`${name} cannot be shown in a ${placement === 'zone' ? 'page zone' : 'tab'}.`, 'Its developer did not make it for this place.'];
}

const needs = (placement: string, name: string, floor: AppVersion | null): string => `This ${placement} requires ${name}${floor === null ? '' : ` ${versionFloorLabel(floor)}`}`;

export function AppZoneRequired({ placement: where, appId, floor, height, view, icon, onInstall, onEnable, onCopyLink, onOpenApps }: AppZoneRequiredProps): JSX.Element {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const button = (label: string, onClick: () => void, testId: string): JSX.Element => (
    <Button variant="outline" className="min-h-[44px] self-start" onClick={onClick} data-testid={testId}>{label}</Button>
  );
  const placement: string = NOUN[where];
  let title: string;
  let detail: string | null = null;
  let action: JSX.Element | null = null;
  switch (view.kind) {
    case 'loading': title = `Loading this ${placement}’s app…`; break;
    case 'not-available': title = `This ${placement} needs “${appId}”, which is not available to you.`; break;
    case 'wrong-surface': [title, detail] = wrongSurface(where, view.name); break;
    case 'install': title = needs(placement, view.name, floor); action = button(`Install ${view.name}`, onInstall, 'app-zone-install'); break;
    case 'ask-admin':
      title = needs(placement, view.name, floor);
      detail = copied === 'yes' ? 'Link copied. Send it to a workspace admin.' : copied === 'failed' ? 'The link could not be copied.' : 'Ask a workspace admin to install it.';
      action = button('Copy link for an admin', () => { void onCopyLink().then(() => setCopied('yes'), () => setCopied('failed')); }, 'app-zone-ask-admin');
      break;
    case 'disabled': title = `${view.name} is installed for you but turned off.`; action = button('Turn on', onEnable, 'app-zone-enable'); break;
    case 'needs-consent': title = `${view.name} ${view.version} needs a new permission; waiting for an admin.`; break;
    case 'suspended': title = `${view.name} has been turned off by an admin.`; break;
    case 'outdated': title = needs(placement, view.name, floor); detail = `You have ${view.installed}.`; action = button('Open in Apps', onOpenApps, 'app-zone-open-apps'); break;
    case 'needs-answer': title = `${view.name} asks you first.`; detail = 'Answer what it asks in Apps → Installed, and it starts here.'; action = button('Open in Apps', onOpenApps, 'app-zone-answer'); break;
    case 'ready-unmounted': title = `${view.name} is installed.`; detail = `It will run here once apps can run ${RUNS[where]}.`; break;
  }
  return (
    <div
      role="group"
      aria-label={GROUP_LABEL[where]}
      data-testid="app-zone-required"
      data-zone-state={view.kind}
      className="not-prose my-4 flex flex-col justify-center gap-[8px] rounded-lg border border-dashed border-border bg-muted/50 p-[16px]"
      style={{ minHeight: `${Math.min(height, 400)}px` }}
    >
      <div className="flex items-start gap-[12px]">
        <AppIconImage icon={view.kind === 'not-available' ? null : icon} size={40} />
        <div className="flex min-w-0 flex-col gap-[4px]">
          <p className="break-words font-medium text-foreground" role={view.kind === 'loading' ? 'status' : undefined}>{title}</p>
          {detail !== null && <p className="break-words text-sm text-muted-foreground" role={copied !== 'no' ? 'status' : undefined}>{detail}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
