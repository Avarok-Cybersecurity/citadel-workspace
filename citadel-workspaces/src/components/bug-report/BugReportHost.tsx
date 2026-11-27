/**
 * Opens the bug reporter when anything asks (lib/bug-report/request.ts). The dialog's code is
 * fetched on its first open, so it costs the landing page nothing.
 */
import { useSyncExternalStore } from 'react';
import { lazyDialog } from '@/components/lazy-dialog';
import { bugReportRequest, type BugReportRequest } from '@/lib/bug-report/request';
import type { BugReportDialogProps } from './BugReportDialog';

const BugReportDialog: (props: BugReportDialogProps) => JSX.Element | null = lazyDialog(
  (): Promise<React.ComponentType<BugReportDialogProps>> => import('./BugReportDialog').then((m) => m.BugReportDialog),
  (props: BugReportDialogProps): boolean => props.request !== null,
);

export function BugReportHost(): JSX.Element | null {
  const request: BugReportRequest | null = useSyncExternalStore(bugReportRequest.subscribe, bugReportRequest.get);
  return <BugReportDialog request={request} onClose={(): void => bugReportRequest.set(null)} />;
}
