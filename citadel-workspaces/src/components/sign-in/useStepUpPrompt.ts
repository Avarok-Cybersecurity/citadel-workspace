/** The step-up dialog as a promise a change can await. */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface StepUpPrompt {
  open: boolean;
  request: () => Promise<string | null | 'cancelled'>;
  confirm: (password: string | null) => void;
  cancel: () => void;
}

export function useStepUpPrompt(): StepUpPrompt {
  const [open, setOpen] = useState<boolean>(false);
  const pending: React.MutableRefObject<((answer: string | null | 'cancelled') => void) | null> = useRef(null);
  useEffect(() => (): void => { pending.current?.('cancelled'); }, []);

  const settle: (answer: string | null | 'cancelled') => void = useCallback((answer: string | null | 'cancelled'): void => {
    const resolve: ((answer: string | null | 'cancelled') => void) | null = pending.current;
    pending.current = null;
    setOpen(false);
    resolve?.(answer);
  }, []);

  const request: () => Promise<string | null | 'cancelled'> = useCallback((): Promise<string | null | 'cancelled'> => new Promise((resolve) => {
    pending.current?.('cancelled');
    pending.current = resolve;
    setOpen(true);
  }), []);

  return { open, request, confirm: settle, cancel: (): void => settle('cancelled') };
}
