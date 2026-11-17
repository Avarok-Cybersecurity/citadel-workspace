/**
 * The messaging trust settings as the server holds them: read on mount, and after a change the
 * settings the server answered with. Nothing is shown as chosen until the server has said.
 */
import { useCallback, useEffect, useState } from 'react';
import type { MessagingTrustSettings } from 'citadel-workspace-client-ts';
import { messagingTrustApi } from '@/lib/messaging-trust/messaging-trust-api';
import { describeFailure } from '@/lib/failure-message';
import { onServerTrustSettings } from '@/lib/messaging-trust/settings-feed';

export interface MessagingTrustState {
  /** `undefined` until the server answers. */
  settings: MessagingTrustSettings | undefined;
  saving: boolean;
  problem: string | null;
  /** Sends one change and adopts the server's answer; resolves false when it was refused. */
  write: (change: () => Promise<MessagingTrustSettings>) => Promise<boolean>;
}

export function useMessagingTrust(): MessagingTrustState {
  const [settings, setSettings] = useState<MessagingTrustSettings | undefined>(undefined);
  const [saving, setSaving] = useState<boolean>(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect((): (() => void) => {
    let live: boolean = true;
    messagingTrustApi.getSettings()
      .then((answer: MessagingTrustSettings): void => { if (live) setSettings(answer); })
      .catch((error: unknown): void => { if (live) setProblem(describeFailure(error, 'The messaging trust settings could not be read.')); });
    // Another screen's change, answered to this tab, is shown here too.
    const unsubscribe: () => void = onServerTrustSettings((answer: MessagingTrustSettings): void => { if (live) setSettings(answer); });
    return (): void => { live = false; unsubscribe(); };
  }, []);

  const write: MessagingTrustState['write'] = useCallback(async (change: () => Promise<MessagingTrustSettings>): Promise<boolean> => {
    setSaving(true);
    setProblem(null);
    try {
      setSettings(await change());
      return true;
    } catch (error: unknown) {
      setProblem(describeFailure(error, 'The server did not accept the change.'));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, saving, problem, write };
}
