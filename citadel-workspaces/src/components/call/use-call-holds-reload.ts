import { useEffect } from 'react';
import { callBusyReason } from '@/lib/call/call-busy';
import { holdReload } from '@/lib/pwa/reload-safety';
import type { CallState } from '@/lib/call/call-state';

/** While this tab is in a call (or ringing), it does not reload by itself (reload-safety.ts). */
export function useCallHoldsReload(call: CallState | null): void {
  const busy: boolean = callBusyReason(call) !== null;
  useEffect((): (() => void) | undefined => (busy ? holdReload('call') : undefined), [busy]);
}
