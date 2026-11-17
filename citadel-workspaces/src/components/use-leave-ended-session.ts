/**
 * The window's way out of a workspace whose session is gone
 * (lib/sessions/leave-ended-session.ts), bound to this app: the router, the
 * toast, and the unsaved-editor prompt every other way out of the editor asks.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { mayLeaveEditor } from '@/lib/leave-editor';
import { leaveEndedSession, type LeaveIO } from '@/lib/sessions/leave-ended-session';

export type LeaveEndedSession = (path: string, message: string) => Promise<void>;

export function useLeaveEndedSession(): LeaveEndedSession {
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  return useCallback((path: string, message: string): Promise<void> => {
    const io: LeaveIO = {
      mayLeave: () => mayLeaveEditor(confirm),
      navigate: (to: string): void => { navigate(to); },
      tell: (text: string): void => { toast({ title: 'Signed out', description: text, variant: 'destructive' }); },
    };
    return leaveEndedSession(io, path, message);
  }, [navigate, toast, confirm]);
}
