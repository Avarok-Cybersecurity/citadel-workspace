/**
 * Settings -> Security -> Stay signed in on this device: how long a sign-in on this device
 * lasts across dropped connections (lib/resume/lifetime.ts).
 */
import { useState } from 'react';
import { Timer } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  loadResumeLifetime, RESUME_LIFETIME_CHOICES, RESUME_LIFETIME_COPY, saveResumeLifetime, STAY_SIGNED_IN_COPY, type ResumeLifetime,
} from '@/lib/resume/lifetime';

export function StaySignedInSection(): JSX.Element {
  const [chosen, setChosen] = useState<ResumeLifetime>(loadResumeLifetime);
  const choose = (next: string): void => {
    const picked: ResumeLifetime | undefined = RESUME_LIFETIME_CHOICES.find((choice: ResumeLifetime): boolean => String(choice) === next);
    if (picked === undefined) return;
    saveResumeLifetime(picked);
    setChosen(picked);
  };
  return (
    <section className="space-y-3" data-testid="settings-stay-signed-in">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <Timer className="h-4 w-4 text-primary-accent" aria-hidden="true" />{STAY_SIGNED_IN_COPY.heading}
      </div>
      <p className="text-xs text-muted-foreground">{STAY_SIGNED_IN_COPY.intro}</p>
      <RadioGroup value={String(chosen)} onValueChange={choose} aria-label={STAY_SIGNED_IN_COPY.groupLabel} className="space-y-1" data-testid="stay-signed-in-choices">
        {RESUME_LIFETIME_CHOICES.map((choice: ResumeLifetime) => (
          <div key={choice} className="flex min-h-11 items-start gap-3 rounded-md p-2 hover:bg-surface/60">
            <RadioGroupItem value={String(choice)} id={`stay-signed-in-${choice}`} className="-mt-0.5" data-testid={`stay-signed-in-${choice}`} />
            <Label htmlFor={`stay-signed-in-${choice}`} className="flex-1 cursor-pointer text-sm font-normal leading-snug">
              <span className="font-medium">{RESUME_LIFETIME_COPY[choice].label}</span>
              <span className="block text-xs text-muted-foreground">{RESUME_LIFETIME_COPY[choice].detail}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
      <p className="text-xs text-muted-foreground" data-testid="stay-signed-in-applies">{STAY_SIGNED_IN_COPY.appliesFrom}</p>
    </section>
  );
}
