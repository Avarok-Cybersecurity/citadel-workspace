import type { ReactNode } from 'react';
import { AlertTriangle, ArrowDownCircle, CheckCircle2, Download, Loader2, PackageCheck, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format-bytes';
import { formatDateTime, formatRelative } from '@/lib/format-time';
import type { AgentUpdate, UpdaterSettings } from '@/lib/agent-update/update-state';
import type { UpdateView } from '@/lib/agent-update/update-view';
import { CheckNowButton } from './CheckNowButton';
import { ReleaseNotes } from './ReleaseNotes';
import { RestartToUpdate } from './RestartToUpdate';
import type { RestartControl } from './use-restart-to-update';

export interface UpdateStatusPanelProps {
  view: UpdateView;
  settings: UpdaterSettings;
  onCheck: () => void;
  restart: RestartControl;
  /** One line for the About tab: the state and `action`, without detail, notes or buttons. */
  compact?: boolean;
  action?: ReactNode;
}

interface Words {
  Icon: LucideIcon;
  tone: string;
  headline: string;
  detail: string;
}

function checkedLine(lastChecked: bigint | null): string {
  if (lastChecked === null) return 'Not checked yet.';
  const at: number = Number(lastChecked) * 1000;
  return `Last checked ${formatDateTime(at)} (${formatRelative(at).toLowerCase()}).`;
}

function sizeLine(update: AgentUpdate): string {
  return update.sizeBytes === undefined ? '' : ` Download size ${formatBytes(update.sizeBytes)}.`;
}

function wordsFor(view: UpdateView, current: string): Words {
  switch (view.kind) {
    case 'checking':
      return { Icon: Loader2, tone: 'text-primary-accent', headline: 'Checking for updates…', detail: 'The agent is asking GitHub for the latest release. This can take a minute.' };
    case 'error':
      return { Icon: AlertTriangle, tone: 'text-destructive-emphasis', headline: 'The last update attempt did not finish', detail: view.message };
    case 'downloading':
      return { Icon: Download, tone: 'text-primary-accent', headline: `Downloading ${view.update.latest}`, detail: `You have ${current}.${sizeLine(view.update)}` };
    case 'ready':
      return { Icon: PackageCheck, tone: 'text-success-emphasis', headline: `Version ${view.update.latest} is ready to install`, detail: `Downloaded and verified. You have ${current}.${sizeLine(view.update)}` };
    case 'available':
      return { Icon: ArrowDownCircle, tone: 'text-warning-emphasis', headline: `Version ${view.update.latest} is available`, detail: `You have ${current}. The agent cannot install it by itself on this computer: download it, then open it.${sizeLine(view.update)}` };
    case 'current':
      return { Icon: CheckCircle2, tone: 'text-success-emphasis', headline: 'Citadel Agent is up to date', detail: `Version ${current}. ${checkedLine(view.lastChecked)}` };
  }
}

function Progress({ value }: { value: number }): JSX.Element {
  const percent: number = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-primary motion-safe:transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{percent}%</p>
    </div>
  );
}

function Ready({ settings, restart, update }: { settings: UpdaterSettings; restart: RestartControl; update: AgentUpdate }): JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" data-testid="agent-update-ready-explainer">
        {settings.autoInstall
          ? 'The agent installs this by itself the next time no account is signed in. To install it now, restart the agent: that signs out every account on this computer.'
          : 'Automatic installs are off, so this waits for you. Restarting the agent installs it and signs out every account on this computer.'}
      </p>
      <RestartToUpdate version={update.latest} restart={restart} />
      {restart.phase.kind === 'restarting' && <p className="text-sm text-muted-foreground">Restarting the agent…</p>}
      {restart.phase.kind === 'failed' && <p className="text-sm text-destructive-emphasis">{restart.phase.message}</p>}
    </div>
  );
}

function DownloadLink({ update }: { update: AgentUpdate }): JSX.Element {
  return (
    <Button size="sm" asChild>
      <a href={update.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid="agent-update-download">
        Download {update.latest}<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Button>
  );
}

/** The updater's state in words, with what to do about it. Every state is one headline, one detail, at most one primary action. */
export function UpdateStatusPanel({ view, settings, onCheck, restart, compact = false, action }: UpdateStatusPanelProps): JSX.Element {
  const { Icon, tone, headline, detail }: Words = wordsFor(view, settings.current);
  const update: AgentUpdate | null = view.kind === 'current' || view.kind === 'checking' ? null : view.update;
  return (
    <div data-testid="agent-update-status" data-state={view.kind} aria-busy={view.kind === 'checking'} className="space-y-4">
      {/* Persistent, so the change of state is announced; the visible text below is not a live region. */}
      <p role="status" className="sr-only">{view.kind === 'error' ? `${headline}. ${detail}` : headline}</p>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone} ${view.kind === 'checking' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{headline}</p>
            {!compact && <p className="break-words text-sm text-muted-foreground">{detail}</p>}
          </div>
        </div>
        {compact && action}
      </div>
      {!compact && view.kind === 'downloading' && <Progress value={view.progress} />}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          {view.kind === 'ready' && <Ready settings={settings} restart={restart} update={view.update} />}
          {view.kind === 'available' && <DownloadLink update={view.update} />}
          {view.kind === 'error' && <CheckNowButton checking={false} onCheck={onCheck} label="Retry" variant="default" />}
          {(view.kind === 'current' || view.kind === 'available' || view.kind === 'checking') && (
            <CheckNowButton checking={view.kind === 'checking'} onCheck={onCheck} />
          )}
        </div>
      )}
      {!compact && update && <ReleaseNotes notes={update.notes} notesUrl={update.notesUrl} version={update.latest} />}
    </div>
  );
}
