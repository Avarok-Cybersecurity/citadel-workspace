import { lazy, Suspense, useRef, useState, type JSX, type LazyExoticComponent, type MutableRefObject } from 'react';
import type HostedTermsModalType from '@/components/terms/HostedTermsModal';
import { isAvarokHosted } from '@/lib/onboarding/hosted';

// The terms text is too large for the landing page's path, which this hook is on.
const HostedTermsModal: LazyExoticComponent<typeof HostedTermsModalType> = lazy(() => import('@/components/terms/HostedTermsModal'));

/** Avarok's Terms of Use, put to a person creating an account on a server Avarok hosts. */
export interface HostedTerms {
  /** True only on an Avarok-hosted server; elsewhere there is nothing to ask. */
  readonly required: boolean;
  /** Opens the dialog; resolves true once accepted, false if it was cancelled. */
  readonly ask: () => Promise<boolean>;
  /** Render this: the open dialog, or `null`. */
  readonly dialog: JSX.Element | null;
}

export function useHostedTerms(serverAddress: string): HostedTerms {
  const [open, setOpen] = useState<boolean>(false);
  const pending: MutableRefObject<((accepted: boolean) => void) | null> = useRef<((accepted: boolean) => void) | null>(null);
  const finish = (accepted: boolean): void => {
    setOpen(false);
    pending.current?.(accepted);
    pending.current = null;
  };
  return {
    required: isAvarokHosted(serverAddress),
    ask: (): Promise<boolean> => new Promise<boolean>((resolve: (accepted: boolean) => void): void => {
      pending.current = resolve;
      setOpen(true);
    }),
    dialog: open ? (
      <Suspense fallback={null}>
        <HostedTermsModal onAccept={(): void => finish(true)} onCancel={(): void => finish(false)} />
      </Suspense>
    ) : null,
  };
}
