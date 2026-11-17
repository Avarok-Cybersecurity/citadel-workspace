/**
 * "Encrypt on this device": one switch for the account's setting, in the document's title bar
 * beside AutoSave and in Settings. Both show the same store, so flipping one moves the other;
 * the explanation is the same words in both (at-rest-copy.ts). A refusal says why, and the
 * switch stays where the setting is.
 */
import { useEffect, useId, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AT_REST_EXPLANATION, AT_REST_LABEL } from '@/lib/at-rest/at-rest-copy';
import { atRestSetting, changeAtRestSetting, readAtRestSetting, type AtRestSetting } from '@/lib/at-rest/at-rest-setting';

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AtRestSwitch({ account, place }: { readonly account: bigint; readonly place: 'titleBar' | 'settings' }): JSX.Element {
  const store: ReturnType<typeof atRestSetting> = atRestSetting(account);
  const setting: AtRestSetting = useSyncExternalStore(store.subscribe, store.get);
  const switchId: string = useId();
  const explanationId: string = useId();
  useEffect((): void => {
    readAtRestSetting(account).catch((error: unknown): void => { toast.error(`Could not read the encryption setting. ${reason(error)}`); });
  }, [account]);
  const change = (on: boolean): void => {
    changeAtRestSetting(account, on).catch((error: unknown): void => { toast.error(reason(error)); });
  };
  const control: JSX.Element = (
    <Switch
      id={switchId}
      checked={setting.on === true}
      disabled={setting.on === null || setting.changing}
      aria-describedby={explanationId}
      data-testid={`docs-at-rest-${place}`}
      onCheckedChange={change}
    />
  );
  if (place === 'settings') {
    return (
      <div className="flex items-start justify-between gap-[16px]">
        <div>
          <label htmlFor={switchId} className="text-sm font-medium text-foreground">{AT_REST_LABEL}</label>
          <p id={explanationId} className="text-sm text-muted-foreground">{AT_REST_EXPLANATION}</p>
        </div>
        {control}
      </div>
    );
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <div className="flex items-center gap-[8px]">
          <TooltipTrigger asChild>{control}</TooltipTrigger>
          <label htmlFor={switchId} className="text-sm text-foreground max-[640px]:sr-only">{AT_REST_LABEL}</label>
          <span id={explanationId} className="sr-only">{AT_REST_EXPLANATION}</span>
        </div>
        <TooltipContent className="max-w-[280px]">{AT_REST_EXPLANATION}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
