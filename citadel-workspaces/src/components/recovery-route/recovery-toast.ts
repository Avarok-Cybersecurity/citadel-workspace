/**
 * A toast whose action is the plan's way out (recovery-toast-view.ts). The view, its controls and
 * the plan registry load with the first one shown, never on the landing path; a chunk that does not
 * load still shows the toast's words (and main.tsx reloads on a failed chunk load).
 */
import { toast } from '@/hooks/use-toast';
import { errorLog } from '@/lib/debug-config';
import type { Recovery } from '@/lib/recovery-route/recovery';
import type { RecoveryToastText } from './recovery-toast-view';

export type { RecoveryToastText };

export function recoveryToast(recovery: Recovery, text: RecoveryToastText): void {
  import('./recovery-toast-view').then(
    (view): void => { view.showRecoveryToast(recovery, text); },
    (error: unknown): void => {
      errorLog('recoveryToast', `${recovery.surface}: the way out did not load`, error);
      toast({ title: text.title, description: text.description, variant: 'destructive' });
    },
  );
}
