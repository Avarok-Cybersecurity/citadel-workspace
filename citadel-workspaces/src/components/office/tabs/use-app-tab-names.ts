/**
 * The name each app tab is labelled with: the app's own name from its listing (the page's zone
 * data, shared with its zones), or, until that answers or when this person cannot see it, a label
 * read from the app id's last segment (`net.avarok.calendar` reads "Calendar"), shown as such.
 */
import { useContext, useEffect, useState } from 'react';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { AppZoneContext, type AppZoneEnvironment } from '../app-zone/app-zone-environment';

export interface AppTabName {
  readonly label: string;
  /** The label is the app's own name, not the one read from its id. */
  readonly known: boolean;
}

export function labelFromAppId(appId: string): string {
  const last: string = appId.split('.').pop() ?? appId;
  const words: string = last.replace(/[-_]+/g, ' ').trim();
  return words.length === 0 ? appId : words.charAt(0).toUpperCase() + words.slice(1);
}

export function useAppTabNames(appIds: readonly string[]): ReadonlyMap<string, AppTabName> {
  const env: AppZoneEnvironment | null = useContext(AppZoneContext);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const key: string = appIds.join('\n');
  useEffect(() => {
    if (env === null) return undefined;
    let live: boolean = true;
    appIds.forEach((appId: string): void => {
      void env.data.listing(appId).then((r: AppsResult<ListedApp>): void => {
        if (!live || !r.ok) return;
        setNames((prev: ReadonlyMap<string, string>) => new Map(prev).set(appId, r.value.manifest.name));
      });
    });
    return (): void => { live = false; };
    // `key` stands for `appIds`: a new array with the same ids asks nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, key]);
  return new Map(appIds.map((appId: string): [string, AppTabName] => {
    const name: string | undefined = names.get(appId);
    return [appId, name === undefined ? { label: labelFromAppId(appId), known: false } : { label: name, known: true }];
  }));
}
