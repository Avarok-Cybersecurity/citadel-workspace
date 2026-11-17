import { useEffect, useState } from 'react';
import { claimCodeFor } from './claim-handoff';

/**
 * Offer the claim code to the workspace-initialization dialog.
 *
 * When this page created the workspace the dialog is opening for, the code the
 * control plane issued is still in memory (claim-handoff.ts) and is filled into
 * the master-password field -- for that workspace and no other, and never over
 * something the user has already typed. The field stays editable.
 *
 * Returns whether it did, so the dialog can say where the value came from.
 */
export function useClaimCodePrefill(
  isOpen: boolean,
  serverAddress: string | undefined,
  setValue: (update: (current: string) => string) => void,
): boolean {
  const [prefilled, setPrefilled] = useState<boolean>(false);
  useEffect(() => {
    if (!isOpen) return;
    const issued: string | undefined = claimCodeFor(serverAddress);
    if (issued === undefined) return;
    setValue((current: string) => current || issued);
    setPrefilled(true);
  }, [isOpen, serverAddress, setValue]);
  return prefilled;
}
