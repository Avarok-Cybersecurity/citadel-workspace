/**
 * A labelled choice of time zone, from the zones this browser knows (known-zones.ts): one control
 * for the schedule's zone, a type's locked zone and the booking page's switcher.
 */
import { useId } from 'react';
import { knownZones } from '@/lib/calendar/known-zones';
import { NativeSelect } from './NativeSelect';

interface ZoneSelectProps {
  label: string;
  value: string;
  /** Listed first when the browser's list names it otherwise. */
  deviceZone: string;
  onChange: (zone: string) => void;
  error?: string | undefined;
}

export function ZoneSelect({ label, value, deviceZone, onChange, error }: ZoneSelectProps): JSX.Element {
  const id: string = useId();
  const zones: string[] = knownZones(deviceZone);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      <NativeSelect
        id={id} className="w-full" value={value} onChange={(e): void => onChange(e.target.value)} aria-invalid={error !== undefined} aria-describedby={error === undefined ? undefined : `${id}-error`}
      >
        {(zones.includes(value) ? zones : [value, ...zones]).map((z: string) => <option key={z} value={z}>{z}</option>)}
      </NativeSelect>
      {error !== undefined && <p id={`${id}-error`} className="text-sm text-destructive-emphasis">{error}</p>}
    </div>
  );
}
