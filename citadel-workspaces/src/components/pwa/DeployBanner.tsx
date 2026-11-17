import { useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDeployNotice, subscribeDeployNotice, type DeployNotice } from '@/lib/pwa/deploy-notice';
import { browserSessionStorage, reloadKeepingDrafts } from '@/lib/chat/draft-handoff';

/** The deploy notice, for the top banner stack to show. */
export function useDeployNotice(): DeployNotice | null {
  return useSyncExternalStore(subscribeDeployNotice, getDeployNotice);
}

const TITLE: Record<DeployNotice['reason'], string> = {
  waiting: 'Update available',
  deployed: 'Update available',
  'activated-elsewhere': 'Updated in another window',
  stale: 'This tab is out of date',
};

/**
 * A new version is out: stays up, with no dismiss, until the page reloads.
 *
 * The reassurance in the copy is what makes the reload safe to take: sessions
 * live in the agent and survive it, and drafts are carried across it
 * (draft-handoff), so nothing is lost by pressing the button.
 */
export function DeployBanner({ notice }: { notice: DeployNotice }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="deploy-banner"
      data-reason={notice.reason}
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm bg-primary text-primary-foreground"
    >
      <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">{TITLE[notice.reason]}</strong>
        {' '}&mdash; reload to continue. You stay signed in and unsent messages are kept.
      </span>
      <Button
        size="sm"
        variant="secondary"
        data-testid="deploy-reload"
        onClick={(): void => reloadKeepingDrafts(browserSessionStorage(), notice.accept)}
      >
        Reload
      </Button>
    </div>
  );
}
