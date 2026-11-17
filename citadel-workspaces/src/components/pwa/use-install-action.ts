import { useCallback } from 'react';
import { usePwaInstall } from './usePwaInstall';
import { useToast } from '@/hooks/use-toast';

/**
 * Installing, plus the confirmation, shared by every entry point that offers it.
 *
 * Extracted when the user menu started offering install too: the landing page's
 * button was the only way in, so anyone already signed in had to know about the
 * browser's own omnibox affordance. Two call sites meant two copies of "did they
 * accept, and what do we say", which is exactly the kind of duplication that
 * drifts — one of them ends up nagging on a decline.
 */
export function useInstallAction(): {
  canInstall: boolean;
  needsManualInstall: boolean;
  installNow: () => void;
} {
  const { canInstall, needsManualInstall, install } = usePwaInstall();
  const { toast } = useToast();

  const installNow: () => void = useCallback((): void => {
    void (async (): Promise<void> => {
      const accepted: boolean = await install();
      // Only on acceptance. Declining is a choice, not an error to report back.
      if (accepted) {
        toast({
          title: 'Citadel installed',
          description: 'You can now launch it like any other app.',
          variant: 'success',
        });
      }
    })();
  }, [install, toast]);

  return { canInstall, needsManualInstall, installNow };
}
