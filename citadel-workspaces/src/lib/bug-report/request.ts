/**
 * A request to open the bug reporter, from anywhere: a route's "Report this problem", the account
 * menu, the crash page. One store, answered by BugReportHost, so a caller needs no dialog code.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';

export interface BugReportRequest {
  /** The surface it was opened from, or 'menu' when the person opened it themself. */
  readonly surface: string;
}

export const bugReportRequest: ValueStore<BugReportRequest | null> = createValueStore<BugReportRequest | null>('bug-report-request', null);

export const requestBugReport = (surface: string): void => bugReportRequest.set({ surface });
