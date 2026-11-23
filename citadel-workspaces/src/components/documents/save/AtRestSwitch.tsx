/**
 * "Encrypt on this device": the account's setting, in Settings -> Security -> Documents on this
 * device. The document's title bar shows its state as a lock (AtRestStatus) from the same store,
 * so flipping it here moves the lock at once. A refusal says why, and the switch stays where the
 * setting is.
 */
import { useId } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { AT_REST_EXPLANATION, AT_REST_LABEL } from '@/lib/at-rest/at-rest-copy';
import { changeAtRestSetting, type AtRestSetting } from '@/lib/at-rest/at-rest-setting';
import { useAtRestSetting } from './use-at-rest-setting';

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AtRestSwitch({ account }: { readonly account: bigint }): JSX.Element {
  const setting: AtRestSetting = useAtRestSetting(account);
  const switchId: string = useId();
  const explanationId: string = useId();
  const change = (on: boolean): void => {
    changeAtRestSetting(account, on).catch((error: unknown): void => { toast.error(reason(error)); });
  };
  return (
    <div className="flex items-start justify-between gap-[16px]">
      <div>
        <label htmlFor={switchId} className="text-sm font-medium text-foreground">{AT_REST_LABEL}</label>
        <p id={explanationId} className="text-sm text-muted-foreground">{AT_REST_EXPLANATION}</p>
      </div>
      <Switch
        id={switchId}
        checked={setting.on === true}
        disabled={setting.on === null || setting.changing}
        aria-describedby={explanationId}
        data-testid="docs-at-rest-settings"
        onCheckedChange={change}
      />
    </div>
  );
}
