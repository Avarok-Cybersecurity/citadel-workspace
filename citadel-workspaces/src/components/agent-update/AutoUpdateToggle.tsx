import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export interface AutoUpdateToggleProps {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** What sits under the label: the version line in Settings, the explanation on the Updates tab. */
  description: ReactNode;
}

/** The agent-wide "install automatically when no account is signed in" setting. On until the user turns it off. */
export function AutoUpdateToggle({ checked, onChange, description }: AutoUpdateToggleProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor="agent-auto-install" className="text-sm font-medium">Automatically install updates when no account is signed in</Label>
        <p id="agent-auto-install-description" className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch id="agent-auto-install" aria-describedby="agent-auto-install-description" data-testid="agent-auto-install"
        checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
