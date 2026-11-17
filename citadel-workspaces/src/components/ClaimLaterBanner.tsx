/**
 * The way back to "Initialize & Become Admin" once the prompt has been set aside.
 *
 * The prompt is suppressed for the tab when someone says they are joining a
 * workspace somebody else set up, or presses "Not now". For the person who
 * actually created it -- live, after a reload -- nothing on screen led back:
 * the sidebar said "An administrator adds the first one" in a workspace with no
 * administrator, and only a new tab would ask again. This offers the step while
 * the workspace is unclaimed, and can itself be set aside.
 */
import { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ClaimLaterBannerProps {
  /** Unclaimed, and this tab's prompt is set aside. */
  visible: boolean;
  onClaim: () => void;
}

export function ClaimLaterBanner({ visible, onClaim }: ClaimLaterBannerProps): JSX.Element | null {
  const [closed, setClosed] = useState<boolean>(false);
  if (!visible || closed) return null;
  return (
    <div role="region" aria-label="Workspace setup" data-testid="claim-later-banner"
      className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border border-warning/40 bg-card px-4 py-3 text-sm text-foreground shadow-lg">
      <ShieldCheck className="h-5 w-5 shrink-0 text-warning-emphasis" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Nobody has claimed this workspace yet. Created it? Claim it with your claim code to become its owner.
      </p>
      <Button type="button" size="sm" onClick={onClaim} data-testid="claim-later-open">Claim it</Button>
      <Button type="button" size="icon" variant="ghost" aria-label="Hide this" onClick={(): void => setClosed(true)}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
