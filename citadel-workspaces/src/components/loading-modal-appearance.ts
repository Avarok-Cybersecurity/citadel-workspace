import { CheckCircle2, Loader2, XCircle , type LucideIcon } from 'lucide-react';

/**
 * How a status looks: which icon, and how it is coloured.
 *
 * Extracted from LoadingModal so the component stays under the file cap after
 * it gained dialog semantics. Pure, and separate, because "which icon means
 * which state" is a rule worth reading on its own — the three states differ
 * only by a ternary chain otherwise, and a fourth state added to the chain is
 * easy to get subtly wrong.
 */
export interface StatusAppearance {
  isLoading: boolean;
  isError: boolean;
  isReady: boolean;
  Icon: LucideIcon;
  iconClass: string;
}

export function statusAppearance(status: string): StatusAppearance {
  const isError: boolean = status === 'error';
  const isReady: boolean = status === 'ready';

  return {
    isLoading: !isReady && !isError,
    isError,
    isReady,
    Icon: isError ? XCircle : isReady ? CheckCircle2 : Loader2,
    iconClass: isError
      ? 'text-destructive'
      : isReady
        ? 'text-success-emphasis'
        : 'animate-spin text-primary-accent',
  };
}
