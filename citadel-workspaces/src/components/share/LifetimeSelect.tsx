/** A lifetime preset: 1 hour to 30 days, the server's longest. Shared by Create and Extend. */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LIFETIME_PRESETS, presetOf, type LifetimePreset } from '@/lib/share/link-lifetime';

export function LifetimeSelect({ id, label, value, onChange, disabled, testId }: {
  id: string;
  label: string;
  value: LifetimePreset | null;
  onChange: (preset: LifetimePreset) => void;
  disabled: boolean;
  testId: string;
}): JSX.Element {
  return (
    <Select value={value ?? undefined} disabled={disabled}
      onValueChange={(next: string): void => { const p: LifetimePreset | null = presetOf(next); if (p) onChange(p); }}>
      <SelectTrigger id={id} aria-label={label} className="h-9 min-w-[8rem]" data-testid={testId}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {LIFETIME_PRESETS.map((p) => <SelectItem key={p.id} value={p.id} data-testid={`${testId}-${p.id}`}>{p.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
