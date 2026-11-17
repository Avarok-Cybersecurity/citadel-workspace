/**
 * Plain or Secure, side by side: what each link reveals, said on the choice itself. Secure is
 * disabled, with the reason under it, where it cannot be made (no permission, several items).
 */
import { Link2, ShieldCheck } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type ShareMode = 'plain' | 'secure';

export const MODE_COPY: Record<ShareMode, { label: string; detail: string }> = {
  plain: { label: 'Plain link', detail: 'Anyone with it sees where it points.' },
  secure: { label: 'Secure link', detail: 'Hides the path; only the people you choose can open it.' },
};

const ICONS: Record<ShareMode, typeof Link2> = { plain: Link2, secure: ShieldCheck };
const MODES: readonly ShareMode[] = ['plain', 'secure'];

export function ShareModeChoice({ value, onChange, secureUnavailable }: {
  value: ShareMode;
  onChange: (mode: ShareMode) => void;
  /** Why Secure cannot be chosen, or null when it can. */
  secureUnavailable: string | null;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <RadioGroup value={value} aria-label="Kind of link" className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        onValueChange={(next: string): void => { const m: ShareMode | undefined = MODES.find((x) => x === next); if (m) onChange(m); }}
        data-testid="share-mode">
        {MODES.map((mode: ShareMode) => {
          const Icon: typeof Link2 = ICONS[mode];
          const disabled: boolean = mode === 'secure' && secureUnavailable !== null;
          return (
            <Label key={mode} htmlFor={`share-mode-${mode}`}
              className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm font-normal leading-snug transition-colors',
                value === mode ? 'border-primary-accent bg-primary-accent/10' : 'border-border hover:bg-surface/60',
                disabled && 'cursor-not-allowed opacity-60')}>
              <RadioGroupItem value={mode} id={`share-mode-${mode}`} disabled={disabled} className="mt-0.5" data-testid={`share-mode-${mode}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-medium"><Icon className="h-4 w-4" aria-hidden="true" />{MODE_COPY[mode].label}</span>
                <span className="block text-xs text-muted-foreground">{MODE_COPY[mode].detail}</span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
      {secureUnavailable !== null && (
        <p className="text-xs text-muted-foreground" data-testid="share-secure-unavailable">{secureUnavailable}</p>
      )}
    </div>
  );
}
