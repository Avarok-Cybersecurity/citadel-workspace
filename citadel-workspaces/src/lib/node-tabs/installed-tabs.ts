/**
 * Which of a node's app tabs are shown: a tab is its app on this page, so one whose app no install
 * reaches here -- uninstalled, or installed only where this person is not -- is not shown. The
 * stored list (tab-list.ts) is kept as it is: it says where each tab goes and in what order, and
 * the installs say whether its app is here, so an app installed again gets its tab back where it
 * was, and an uninstall needs no second write to every node that listed it. Pure.
 *
 * While the installs are not known, or could not be read, every tab is shown: its pane says what
 * it waits for or what went wrong (AppTabPane.tsx), rather than a tab silently missing.
 */
import type { AppInstall } from 'citadel-workspace-client-ts';
import { covers } from '@/lib/citadel-apps/install-covers';
import type { NodeTab } from './tab-list';

export type InstallsHere =
  | { readonly kind: 'unknown' }
  | {
    readonly kind: 'known';
    readonly installs: readonly AppInstall[];
    readonly me: string;
    readonly nodeId: string;
    /** The node's ancestors, nearest first. */
    readonly ancestors: readonly string[];
  };

export const INSTALLS_UNKNOWN: InstallsHere = { kind: 'unknown' };

/** Whether an install of `appId` reaches this person on this node, as far as is known. */
export function reachesHere(appId: string, here: InstallsHere): boolean {
  if (here.kind === 'unknown') return true;
  return here.installs.some((i: AppInstall): boolean => i.app_id === appId && covers(i.scope, here.me, here.nodeId, here.ancestors));
}

/** `tabs` without the app tabs whose app is not here. */
export function shownTabs(tabs: readonly NodeTab[], here: InstallsHere): readonly NodeTab[] {
  return tabs.filter((tab: NodeTab): boolean => tab.kind !== 'app' || reachesHere(tab.appId, here));
}
