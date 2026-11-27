/**
 * An apps request that did not do what was asked (an install the server refused, or the listing a
 * link named): what happened, and the ways out its surface declares (recovery-route/surfaces/
 * apps.ts), drawn by RecoveryNotice. Someone who manages apps is also told what `Unavailable` can mean.
 */
import { RecoveryNotice } from '@/components/recovery-route/RecoveryNotice';
import { recovery } from '@/lib/recovery-route/recovery';
import type { AppsBinding, AppsSurfaceId } from '@/lib/recovery-route/surfaces/apps';

interface AppsRefusalNoticeProps {
  surface: AppsSurfaceId;
  /** What happened, in words. */
  message: string;
  /** More words for someone who manages apps (refused-install.ts `managersLine`); null for everyone else. */
  forManagers: string | null;
  binding: AppsBinding;
  testId: string;
}

export function AppsRefusalNotice({ surface, message, forManagers, binding, testId }: AppsRefusalNoticeProps): JSX.Element {
  return (
    <div className="py-[12px]" data-testid={testId}>
      <RecoveryNotice
        recovery={recovery(surface, binding)}
        message={(
          <div className="flex flex-col gap-[8px]">
            <p className="break-words">{message}</p>
            {forManagers !== null && <p className="break-words text-muted-foreground" data-testid="apps-install-failed-managers">{forManagers}</p>}
          </div>
        )}
      />
    </div>
  );
}
