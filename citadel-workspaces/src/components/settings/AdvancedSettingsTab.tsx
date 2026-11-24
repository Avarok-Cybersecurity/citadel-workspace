/**
 * Settings -> Advanced: what this device shows beyond what using the product needs. Dev mode is
 * per device (lib/dev-mode.ts) and off until turned on here.
 */
import { useId, useState } from 'react';
import { Code2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useDevMode } from '@/hooks/use-dev-mode';
import { devMode } from '@/lib/dev-mode-device';
import { describeFailure } from '@/lib/failure-message';

export function AdvancedSettingsTab(): JSX.Element {
  const on: boolean | null = useDevMode();
  const [error, setError] = useState<string | null>(null);
  const switchId: string = useId();
  const hintId: string = useId();
  const change = (next: boolean): void => {
    setError(null);
    devMode.change(next).catch((e: unknown): void => { setError(describeFailure(e, 'Dev mode was not saved.')); });
  };
  return (
    <div className="space-y-5" data-testid="settings-advanced">
      <section className="flex items-start justify-between gap-[16px] rounded-lg bg-background/50 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-accent" aria-hidden="true" />
          <div className="min-w-0">
            <label htmlFor={switchId} className="text-sm font-medium text-foreground">Dev mode</label>
            <p id={hintId} className="text-xs text-muted-foreground">
              Shows internals on this device, such as whether this tab leads the others or follows. For this device only.
            </p>
            {error !== null && <p role="alert" className="mt-1 text-xs text-destructive-emphasis">{error}</p>}
          </div>
        </div>
        <Switch id={switchId} checked={on === true} disabled={on === null} aria-describedby={hintId} data-testid="dev-mode-switch" onCheckedChange={change} />
      </section>
    </div>
  );
}
