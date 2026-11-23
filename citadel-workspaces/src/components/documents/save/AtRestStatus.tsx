/**
 * The document title bar's lock: whether "Encrypt on this device" is on for this account here.
 * A status, not a switch -- the setting lives in Settings -> Security -> Documents on this device,
 * and pressing the lock opens it there. Its name is the status, so a screen reader hears it; the
 * tooltip shows on hover and on keyboard focus, and a tap opens the setting, which says the same.
 * Never "locked" before the setting is known.
 */
import { useId } from 'react';
import { CircleHelp, Loader2, Lock, LockOpen, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { requestSettings } from '@/lib/settings-request';
import { AT_REST_WHERE_TO_CHANGE } from '@/lib/at-rest/at-rest-copy';
import { AT_REST_STATUS_TEXT, atRestStatusOf, type AtRestStatus as Status } from '@/lib/at-rest/at-rest-status';
import { useAtRestSetting } from './use-at-rest-setting';

const ICON: Readonly<Record<Status, LucideIcon>> = { on: Lock, off: LockOpen, changing: Loader2, unknown: CircleHelp };

export function AtRestStatus({ account }: { readonly account: bigint }): JSX.Element {
  const status: Status = atRestStatusOf(useAtRestSetting(account));
  const hintId: string = useId();
  const Icon: LucideIcon = ICON[status];
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={AT_REST_STATUS_TEXT[status]}
              aria-describedby={hintId}
              data-testid="docs-at-rest-status"
              data-status={status}
              onClick={(): void => requestSettings('security')}
              className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Icon className={status === 'on' ? 'h-[18px] w-[18px]' : 'h-[18px] w-[18px] text-muted-foreground'} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[280px]" data-testid="docs-at-rest-status-tip">
            <p className="font-medium">{AT_REST_STATUS_TEXT[status]}</p>
            <p className="text-muted-foreground">{AT_REST_WHERE_TO_CHANGE}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span id={hintId} className="sr-only">{AT_REST_WHERE_TO_CHANGE}</span>
    </>
  );
}
