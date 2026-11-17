/**
 * Removing an install: whether its stored data goes too has no default. Uninstall stays disabled
 * until the person has chosen, so nobody deletes an app's data, or keeps it, without saying so.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface UninstallConfirmProps {
  appName: string;
  onConfirm: (purgeStorage: boolean) => void;
  onCancel: () => void;
  busy: boolean;
}

export function UninstallConfirm({ appName, onConfirm, onCancel, busy }: UninstallConfirmProps): JSX.Element {
  const [purge, setPurge] = useState<boolean | null>(null);
  const option = (value: boolean, label: string, detail: string): JSX.Element => {
    const id: string = `apps-uninstall-${value ? 'purge' : 'keep'}`;
    return (
      <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-start gap-[10px] rounded-md px-[8px] py-[6px] hover:bg-muted/50">
        <input id={id} type="radio" name="apps-uninstall-data" className="mt-[4px] h-[18px] w-[18px] shrink-0" checked={purge === value} onChange={() => setPurge(value)} data-testid={id} />
        <span className="flex flex-col text-sm text-foreground">
          {label}
          <span className="text-xs text-muted-foreground">{detail}</span>
        </span>
      </label>
    );
  };
  return (
    <fieldset className="flex flex-col gap-[6px] rounded-lg border border-border p-[12px]" data-testid="apps-uninstall-confirm">
      <legend className="px-[4px] text-sm font-medium text-foreground">Uninstall {appName}?</legend>
      {option(false, 'Keep its data', 'Installing it again later finds what it saved.')}
      {option(true, 'Delete its data', 'Everything it saved for this install is removed for good.')}
      <div className="flex flex-wrap gap-[8px] pt-1">
        <Button variant="outline" className="min-h-[44px]" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="destructive" className="min-h-[44px]" disabled={purge === null || busy} onClick={() => { if (purge !== null) onConfirm(purge); }} data-testid="apps-uninstall-go">
          Uninstall
        </Button>
      </div>
    </fieldset>
  );
}
