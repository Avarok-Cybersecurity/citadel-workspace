/**
 * The placeholder an app zone draws instead of its app (design 2.6): a bordered panel of the
 * zone's height saying what the zone needs and the one thing this person can do about it. An app
 * outside your audience reads exactly like one that does not exist, and shows no icon of its own.
 * The same panel stands for an app's settings outside its tab (`setting`), from the same view.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { versionFloorLabel, type AppVersion } from '@/lib/citadel-apps/app-identity';
import { AppIconImage } from '@/components/citadel-apps/marketplace/AppIconImage';
import type { ZoneView } from './zone-state';
import { MemberAnswerPrompt } from './MemberAnswerPrompt';

/**
 * A view that is not a running app: one zoneView decided, an app ready where apps cannot run
 * (`ready-unmounted`), or one waiting while its member answers in Apps (`answering`).
 */
export type PlaceholderView = Exclude<ZoneView, { kind: 'ready' }> | { kind: 'ready-unmounted'; name: string } | { kind: 'answering'; name: string };

/** What a placed app shows when it is not running: its view, or why a ready one is not. */
export const placeholderFor = (view: ZoneView, waiting: boolean): PlaceholderView =>
  view.kind !== 'ready' ? view : { kind: waiting ? 'answering' : 'ready-unmounted', name: view.app.manifest.name };

/** Where the app would run: a zone in a page, a tab of the node's pane, or a page of settings. */
export type Placement = 'zone' | 'tab' | 'setting';

const SURFACE: Readonly<Record<Placement, string>> = { zone: 'a page zone', tab: 'a tab', setting: 'these settings' };
const GROUP: Readonly<Record<Placement, string>> = { zone: 'App zone', tab: 'App tab', setting: 'App settings' };

interface AppZoneRequiredProps {
  placement: Placement;
  appId: string;
  floor: AppVersion | null;
  height: number;
  view: PlaceholderView;
  icon: Parameters<typeof AppIconImage>[0]['icon'];
  onInstall: () => void;
  onEnable: () => void;
  onCopyLink: () => Promise<void>;
  onOpenApps: () => void;
  onRetry: () => void;
  onAnswer: (allowed: boolean) => Promise<void>;
}

const needs = (placement: Placement, name: string, floor: AppVersion | null): string => `This ${placement} requires ${name}${floor === null ? '' : ` ${versionFloorLabel(floor)}`}`;
const NOT_HERE: string = 'It is installed in this workspace, but not for you here.';

export function AppZoneRequired({ placement, appId, floor, height, view, icon, onInstall, onEnable, onCopyLink, onOpenApps, onRetry, onAnswer }: AppZoneRequiredProps): JSX.Element {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const button = (label: string, onClick: () => void, testId: string): JSX.Element => (
    <Button variant="outline" className="min-h-[44px] self-start" onClick={onClick} data-testid={testId}>{label}</Button>
  );
  let title: string;
  let detail: string | null = null;
  let action: JSX.Element | null = null;
  switch (view.kind) {
    case 'loading': title = `Loading this ${placement}’s app…`; break;
    case 'failed': title = `This ${placement}’s app could not be loaded.`; detail = 'The server did not answer, or its answer could not be read.'; action = button('Try again', onRetry, 'app-zone-retry'); break;
    case 'not-available': title = `This ${placement} needs “${appId}”, which is not available to you.`; detail = 'Ask a workspace admin whether it can be installed for you.'; break;
    case 'wrong-surface': title = `${view.name} cannot be shown in ${SURFACE[placement]}.`; detail = 'Its developer did not make it for this place.'; break;
    case 'install': title = needs(placement, view.name, floor); detail = view.elsewhere ? NOT_HERE : null; action = button(`Install ${view.name}`, onInstall, 'app-zone-install'); break;
    case 'ask-admin':
      title = needs(placement, view.name, floor);
      detail = copied === 'yes' ? 'Link copied. Send it to a workspace admin.' : copied === 'failed' ? 'The link could not be copied.' : `${view.elsewhere ? `${NOT_HERE} ` : ''}Ask a workspace admin to install it${view.elsewhere ? ' for you' : ''}.`;
      action = button('Copy link for an admin', () => { void onCopyLink().then(() => setCopied('yes'), () => setCopied('failed')); }, 'app-zone-ask-admin');
      break;
    case 'disabled': title = `${view.name} is installed for you but turned off.`; action = button('Turn on', onEnable, 'app-zone-enable'); break;
    case 'needs-consent': title = `${view.name} ${view.version} needs a new permission; waiting for an admin.`; break;
    case 'suspended': title = `${view.name} has been turned off by an admin.`; break;
    case 'outdated': title = needs(placement, view.name, floor); detail = `You have ${view.installed}.`; action = button('Open in Apps', onOpenApps, 'app-zone-open-apps'); break;
    case 'needs-answer': title = `${view.name} needs your OK first.`; action = <MemberAnswerPrompt name={view.name} asks={view.asks} onAnswer={onAnswer} />; break;
    case 'answering': title = `${view.name} starts when you finish answering in Apps.`; break;
    case 'ready-unmounted': title = `${view.name} is installed.`; detail = 'Apps cannot run on this page.'; break;
  }
  return (
    <div
      role="group"
      aria-label={GROUP[placement]}
      data-testid="app-zone-required"
      data-zone-state={view.kind}
      className="not-prose my-4 flex flex-col justify-center gap-[8px] rounded-lg border border-dashed border-border bg-muted/50 p-[16px]"
      style={{ minHeight: `${Math.min(height, 400)}px` }}
    >
      <div className="flex items-start gap-[12px]">
        <AppIconImage icon={view.kind === 'not-available' || view.kind === 'failed' ? null : icon} size={40} />
        <div className="flex min-w-0 flex-col gap-[4px]">
          <p className="break-words font-medium text-foreground" role={view.kind === 'loading' ? 'status' : view.kind === 'failed' ? 'alert' : undefined}>{title}</p>
          {detail !== null && <p className="break-words text-sm text-muted-foreground" role={copied !== 'no' ? 'status' : undefined}>{detail}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
