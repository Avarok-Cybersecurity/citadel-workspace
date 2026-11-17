/**
 * Navigate, but ask first when an open document has unsaved edits.
 *
 * In-app navigation unmounts the document editor, and its buffer goes with it.
 * `mayLeaveEditor` is the check; this is the check bound to the router, so a
 * control that leaves the editor cannot reach `navigate` without it. The
 * Messages icon, the title's "go up", the group rows, the ongoing-call bar and
 * a notification's "open conversation" each called `navigate` directly and
 * discarded the buffer without a word.
 *
 * Resolves either way: when the user keeps the edit, staying put IS the
 * outcome, and there is nothing for a caller to report.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavigateFunction, NavigateOptions, To } from 'react-router';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { mayLeaveEditor } from '@/lib/leave-editor';

export type GuardedNavigate = (to: To, options?: NavigateOptions) => Promise<void>;

export function useGuardedNavigate(): GuardedNavigate {
  const navigate: NavigateFunction = useNavigate();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  return useCallback(
    async (to: To, options?: NavigateOptions): Promise<void> => {
      if (await mayLeaveEditor(confirm)) navigate(to, options);
    },
    [navigate, confirm],
  );
}
