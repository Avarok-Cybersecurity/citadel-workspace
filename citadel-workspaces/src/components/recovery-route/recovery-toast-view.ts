/**
 * A failure toast that carries its way out: the plan's first manual route is the toast's action,
 * labelled by the route, never by the call site. Callable from lib code (outside React); the
 * ports are resolved when the action is pressed (ports-store.ts).
 */
import type React from 'react';
import { toast, type ToastHandle } from '@/hooks/use-toast';
import { controlFor, type Control } from '@/lib/recovery-route/controls';
import type { AnyBinding } from '@/lib/recovery-route/binding';
import { manualPrimary } from '@/lib/recovery-route/derive';
import { lateBoundPorts } from '@/lib/recovery-route/ports-store';
import type { Recovery } from '@/lib/recovery-route/recovery';
import { planOf } from '@/lib/recovery-route/plan-of';
import { recordTrail } from '@/lib/recovery-route/trail';
import type { RecoveryPlan } from '@/lib/recovery-route/route';
import { errorLog } from '@/lib/debug-config';

export interface RecoveryToastText {
  readonly title: string;
  readonly description?: React.ReactNode;
}

export function showRecoveryToast(recovery: Recovery, text: RecoveryToastText): ToastHandle {
  const plan: RecoveryPlan = planOf(recovery.surface);
  const control: Control = controlFor(manualPrimary(plan), recovery.binding as AnyBinding, lateBoundPorts, recovery.surface);
  recordTrail({ at: Date.now(), kind: 'shown', surface: recovery.surface });
  return toast({
    title: text.title,
    description: text.description,
    variant: 'destructive',
    action: {
      label: control.label,
      onClick: (): void => {
        recordTrail({ at: Date.now(), kind: 'taken', surface: recovery.surface, route: control.kind });
        control.run().catch((error: unknown): void => errorLog('recoveryToast', `${recovery.surface}: ${control.kind} failed`, error));
      },
    },
  });
}
