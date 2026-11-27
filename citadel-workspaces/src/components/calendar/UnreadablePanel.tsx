import type { ReactNode } from 'react';
import { RecoveryNotice } from '@/components/recovery-route/RecoveryNotice';
import { recovery } from '@/lib/recovery-route/recovery';

/**
 * What a Calendar panel shows in place of data it could not read: what and why, and Try again,
 * which reads it again (lib/recovery-route/surfaces/calendar.ts). `what` names the data.
 */
export function UnreadablePanel({ what, reason, retry }: { readonly what: ReactNode; readonly reason: string; readonly retry: () => Promise<void> }): JSX.Element {
  return <RecoveryNotice recovery={recovery('calendar.unreadable', { retry })} message={<>{what} could not be read: {reason}.</>} />;
}
