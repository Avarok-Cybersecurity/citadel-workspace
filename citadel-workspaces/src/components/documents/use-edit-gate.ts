/**
 * Whether this account may edit the document now: the server's answer, remembered on this
 * device each time it comes, and with the link down (the check unanswered) the last answer
 * remembered (lib/document-save/last-known-access.ts).
 */
import { useEffect, useState } from 'react';
import { usePermission } from '@/hooks/use-permission';
import { gateOnKnownAnswer, permits, type ActionGate, type UsePermissionResult } from '@/hooks/use-permission-result';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { Permission } from '@/contexts/PermissionsContext';
import { errorLog } from '@/lib/debug-config';
import { isServerAnswer, lastKnownEditAnswer, offlineEditGate, rememberEditAnswer } from '@/lib/document-save/last-known-access';

export function useEditGate(nodeId: string): ActionGate {
  const answer: UsePermissionResult = usePermission(nodeId, Permission.EditContent);
  const account: bigint | null = useTabIdentity()?.cid ?? null;
  const [lastKnown, setLastKnown] = useState<boolean | null>(null);
  // Of a server answer, permits() is its yes or no (no loading, unanswered or missing state is left).
  const known: boolean | null = isServerAnswer(answer) ? permits(answer) : null;

  useEffect((): void => {
    if (account === null || known === null) return;
    rememberEditAnswer(account, nodeId, known).catch((error: unknown): void => { errorLog('DocumentEditGate', 'Could not keep the edit answer on this device', error); });
  }, [account, nodeId, known]);

  useEffect((): (() => void) | undefined => {
    if (account === null || !answer.unanswered) return undefined;
    let live: boolean = true;
    lastKnownEditAnswer(account, nodeId).then(
      (kept: boolean | null): void => { if (live) setLastKnown(kept); },
      (error: unknown): void => { errorLog('DocumentEditGate', 'Could not read the kept edit answer', error); },
    );
    return (): void => { live = false; };
  }, [account, nodeId, answer.unanswered]);

  return offlineEditGate(answer, lastKnown, gateOnKnownAnswer(answer));
}
