/**
 * The member's Calendar settings from `cal/settings` (storage.user): read once per mount, and
 * written when they answer the zone question. Absent or unreadable settings are `absent`, which
 * asks; a refused read is `failed`, which says so rather than asking a question it cannot save.
 */
import { useCallback, useEffect, useState } from 'react';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import { decodeSettings, encodeSettings, SETTINGS_KEY, type CalendarSettings, type DisplayZoneChoice } from '@/lib/calendar/zones';

export type SettingsState =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: string }
  | { kind: 'absent'; saving: boolean; error: string | null; choose: (choice: DisplayZoneChoice) => void }
  | { kind: 'ready'; settings: CalendarSettings };

type Read = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'absent' } | { kind: 'ready'; settings: CalendarSettings };

const reasonOf = (error: unknown): string => (error instanceof PortRefused ? refusalCopy(error.refused) : 'something went wrong');

export function useCalendarSettings(ports: CalendarPorts): SettingsState {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live: boolean = true;
    ports.storage.get({ kind: 'user' }, SETTINGS_KEY).then((bytes: Uint8Array | null): void => {
      if (!live) return;
      const settings: CalendarSettings | null = bytes === null ? null : decodeSettings(bytes);
      setRead(settings === null ? { kind: 'absent' } : { kind: 'ready', settings });
    }, (e: unknown): void => { if (live) setRead({ kind: 'failed', reason: reasonOf(e) }); });
    return (): void => { live = false; };
  }, [ports]);
  const choose: (choice: DisplayZoneChoice) => void = useCallback((choice: DisplayZoneChoice): void => {
    const settings: CalendarSettings = { displayZone: choice };
    setSaving(true);
    setError(null);
    ports.storage.set({ kind: 'user' }, SETTINGS_KEY, encodeSettings(settings)).then((): void => setRead({ kind: 'ready', settings }), (e: unknown): void => {
      setError(`Your choice could not be saved: ${reasonOf(e)}.`);
    }).finally((): void => setSaving(false));
  }, [ports]);
  if (read.kind === 'absent') return { kind: 'absent', saving, error, choose };
  return read;
}
