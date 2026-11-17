/**
 * The one place a window asks the agent's updater anything: the status at start (and again
 * whenever the socket comes back), Check now, and the automatic-install setting. The settings
 * row, the banner and the /agent page all read and act through it, so none keeps its own copy
 * of the update logic.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { askUpdater } from '@/lib/agent-update/requests';
import { agentUpdate, updaterSettings, type AgentUpdate, type UpdaterSettings } from '@/lib/agent-update/update-state';
import { describeFailure } from '@/lib/failure-message';

/** `absent`: the agent has not answered (not installed, not running, or older than its updater). */
export type AgentPresence = 'loading' | 'present' | 'absent';

export interface Updater {
  presence: AgentPresence;
  settings: UpdaterSettings | null;
  update: AgentUpdate | null;
  /** A check this window asked for is in flight. */
  checking: boolean;
  /** This window's own failure to check, in words. */
  error: string | null;
  /** The automatic-install setting was not saved, in words. */
  settingError: string | null;
  check: () => void;
  setAutoInstall: (on: boolean) => void;
}

export function useUpdater(): Updater {
  const settings: UpdaterSettings | null = useSyncExternalStore(updaterSettings.subscribe, updaterSettings.get);
  const update: AgentUpdate | null = useSyncExternalStore(agentUpdate.subscribe, agentUpdate.get);
  const [asked, setAsked] = useState<'pending' | 'failed' | 'answered'>('pending');
  const [checking, setChecking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [settingError, setSettingError] = useState<string | null>(null);

  useEffect((): (() => void) => {
    let live: boolean = true;
    const ask = (): void => {
      askUpdater('UpdateGetStatus').then(
        (): void => { if (live) setAsked('answered'); },
        (): void => { if (live) setAsked('failed'); },
      );
    };
    ask();
    // A page opened before its socket was up fails the first ask; the socket opening is the retry.
    const off: () => void = eventEmitter.on('on-ws-connection-success', ask);
    return (): void => { live = false; off(); };
  }, []);

  const check: () => void = useCallback((): void => {
    setChecking(true);
    setError(null);
    askUpdater('UpdateCheckNow')
      .catch((e: unknown): void => setError(describeFailure(e, 'The check did not finish.')))
      .finally((): void => setChecking(false));
  }, []);

  const setAutoInstall: (on: boolean) => void = useCallback((on: boolean): void => {
    setSettingError(null);
    askUpdater('UpdateSetSettings', { auto_install: on })
      .catch((e: unknown): void => setSettingError(describeFailure(e, 'The setting was not saved.')));
  }, []);

  const known: boolean = settings !== null && settings.current !== '';
  const presence: AgentPresence = known ? 'present' : asked === 'failed' ? 'absent' : 'loading';
  return { presence, settings, update, checking, error, settingError, check, setAutoInstall };
}
