/**
 * The one question the Calendar asks before it shows a time (design 3.4): which zone to show
 * times in. Following the device is an answer the member gives, never assumed; the answer is
 * kept in their own settings, so it is asked once, not on every device.
 */
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { knownZones } from '@/lib/calendar/known-zones';
import type { DisplayZoneChoice } from '@/lib/calendar/zones';
import { NativeSelect } from './NativeSelect';

interface ZoneQuestionProps {
  deviceZone: string;
  saving: boolean;
  error: string | null;
  onChoose: (choice: DisplayZoneChoice) => void;
}

const OPTION: string = 'flex min-h-[44px] items-center gap-3 rounded-md border border-border px-3 py-2 text-sm text-foreground has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';

export function ZoneQuestion({ deviceZone, saving, error, onChoose }: ZoneQuestionProps): JSX.Element {
  const [kind, setKind] = useState<DisplayZoneChoice['kind']>('device');
  const [fixed, setFixed] = useState<string>(deviceZone);
  const name: string = useId();
  const selectId: string = useId();
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    onChoose(kind === 'device' ? { kind: 'device' } : { kind: 'fixed', zone: fixed });
  };
  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-col gap-3 p-[16px]" data-testid="calendar-zone-question" aria-labelledby={`${name}-heading`}>
      <h2 id={`${name}-heading`} className="text-base font-semibold text-foreground">Which time zone should your Calendar show?</h2>
      <p className="text-sm text-muted-foreground">Every time is shown in this zone. Events made in another zone say which one beside them. You can change this later.</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Time zone</legend>
        <label className={OPTION}>
          <input type="radio" name={name} value="device" checked={kind === 'device'} onChange={(): void => setKind('device')} className="h-4 w-4 accent-primary" />
          <span>Follow this device: <span className="font-medium">{deviceZone}</span></span>
        </label>
        <label className={OPTION}>
          <input type="radio" name={name} value="fixed" checked={kind === 'fixed'} onChange={(): void => setKind('fixed')} className="h-4 w-4 accent-primary" />
          <span>Always use one zone</span>
        </label>
      </fieldset>
      {kind === 'fixed' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={selectId} className="text-sm font-medium text-foreground">Zone</label>
          <NativeSelect id={selectId} className="w-full" value={fixed} onChange={(e): void => setFixed(e.target.value)}>
            {knownZones(deviceZone).map((z: string) => <option key={z} value={z}>{z}</option>)}
          </NativeSelect>
        </div>
      )}
      {error !== null && <p role="alert" className="text-sm text-destructive-emphasis">{error}</p>}
      <Button type="submit" className="min-h-[44px] self-start" disabled={saving}>{saving ? 'Saving…' : 'Show my Calendar'}</Button>
    </form>
  );
}
