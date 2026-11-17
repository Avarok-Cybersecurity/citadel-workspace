/**
 * The member's Calendar notification settings (notify-prefs.ts) as a form edits them: read once per
 * ports, saved on each change, one save at a time. Settings that cannot be read are shown as what
 * applies (the ones before a choice), with that said; a refused read says why and offers nothing.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { readPrefs } from '@/lib/calendar/notice-gate';
import { decodePrefs, encodePrefs, NOTIFY_PREFS_KEY, type NotifyPrefs } from '@/lib/calendar/notify-prefs';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';

export type PrefsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly reason: string }
  | {
    readonly kind: 'ready';
    readonly prefs: NotifyPrefs;
    /** Whether the member has saved any: false shows what applies before they choose. */
    readonly chosen: boolean;
    readonly saving: boolean;
    readonly error: string | null;
    readonly save: (next: NotifyPrefs) => void;
  };

type Read = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; prefs: NotifyPrefs; chosen: boolean };

const reasonOf = (error: unknown): string => (error instanceof PortRefused ? refusalCopy(error.refused) : 'something went wrong');

export function useNotifyPrefs(ports: CalendarPorts): PrefsState {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const turn: MutableRefObject<Promise<void>> = useRef<Promise<void>>(Promise.resolve());
  /** What is kept, read again: on mount, and after a save that failed, so the form never shows what was not saved. */
  const reread: () => Promise<Read> = useCallback(async (): Promise<Read> => {
    const bytes: Uint8Array | null = await ports.storage.get({ kind: 'user' }, NOTIFY_PREFS_KEY);
    return { kind: 'ready', prefs: await readPrefs(ports.storage), chosen: bytes !== null && decodePrefs(bytes) !== null };
  }, [ports]);
  useEffect(() => {
    let live: boolean = true;
    setRead({ kind: 'loading' });
    reread().then((r: Read): void => { if (live) setRead(r); }, (e: unknown): void => { if (live) setRead({ kind: 'failed', reason: reasonOf(e) }); });
    return (): void => { live = false; };
  }, [reread]);
  const save: (next: NotifyPrefs) => void = useCallback((next: NotifyPrefs): void => {
    setRead({ kind: 'ready', prefs: next, chosen: true });
    setSaving(true);
    setError(null);
    turn.current = turn.current.then(() => ports.storage.set({ kind: 'user' }, NOTIFY_PREFS_KEY, encodePrefs(next))).then((): void => setSaving(false), async (e: unknown): Promise<void> => {
      setError(`Your change was not saved: ${reasonOf(e)}.`);
      setRead(await reread().catch((): Read => ({ kind: 'failed', reason: reasonOf(e) })));
      setSaving(false);
    });
  }, [ports, reread]);
  if (read.kind !== 'ready') return read;
  return { kind: 'ready', prefs: read.prefs, chosen: read.chosen, saving, error, save };
}
