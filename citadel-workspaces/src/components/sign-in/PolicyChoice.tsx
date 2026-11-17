import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { POLICY_COPY } from '@/lib/sign-in/copy';
import type { SignInPolicy } from '@/lib/sign-in/types';

/** The sign-in policy as a radio group: what each one asks for, in words. */
export function PolicyChoice<P extends SignInPolicy>({ id, value, options, onChange, disabled }: {
  id: string;
  value: P;
  options: readonly P[];
  onChange: (policy: P) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next: string) => { const picked: P | undefined = options.find((o) => o === next); if (picked) onChange(picked); }}
      disabled={disabled}
      aria-label="How you sign in"
      className="space-y-2"
      data-testid={`${id}-policy`}
    >
      {options.map((policy: P) => (
        <div key={policy} className="flex items-start gap-2">
          <RadioGroupItem value={policy} id={`${id}-${policy}`} className="-mt-0.5" data-testid={`${id}-policy-${policy}`} />
          <Label htmlFor={`${id}-${policy}`} className="text-sm font-normal leading-snug">
            <span className="font-medium">{POLICY_COPY[policy].label}</span>
            <span className="block text-xs text-muted-foreground">{POLICY_COPY[policy].detail}</span>
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}
