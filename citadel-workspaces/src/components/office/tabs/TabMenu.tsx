/**
 * The tab menu ("⋯"): reorder or remove the open app tab, make this page follow the workspace's
 * default tabs again, or make this page's tabs the default for every page. A button with a menu,
 * not a drag or a hover affordance, so it works the same by touch, keyboard and pointer; it is
 * drawn only for someone who may make at least one of these changes, and offers only those.
 */
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { appIdsOf, type NodeTab } from '@/lib/node-tabs/tab-list';
import type { NodeTabsModel, TabChange } from './use-node-tabs';
import type { AppTabName } from './use-app-tab-names';

interface TabMenuProps {
  model: NodeTabsModel;
  names: ReadonlyMap<string, AppTabName>;
}

interface MenuItem {
  key: string;
  label: string;
  change: TabChange;
  disabled: boolean;
}

/** What this person may do from the menu with `model` as it stands; empty means no menu. */
export function tabMenuItems(model: NodeTabsModel, names: ReadonlyMap<string, AppTabName>): MenuItem[][] {
  const open: NodeTab | undefined = model.list.tabs.find((tab: NodeTab): boolean => tab.key === model.active);
  const appIds: string[] = appIdsOf(model.list);
  const groups: MenuItem[][] = [];
  if (model.canConfigure && open?.kind === 'app') {
    const at: number = appIds.indexOf(open.appId);
    const name: string = names.get(open.appId)?.label ?? open.appId;
    groups.push([
      { key: 'left', label: `Move ${name} left`, change: { kind: 'left', appId: open.appId }, disabled: at <= 0 },
      { key: 'right', label: `Move ${name} right`, change: { kind: 'right', appId: open.appId }, disabled: at >= appIds.length - 1 },
      { key: 'remove', label: `Remove the ${name} tab`, change: { kind: 'remove', appId: open.appId }, disabled: false },
    ]);
  }
  const page: MenuItem[] = [];
  if (model.canConfigure && model.list.source === 'node' && !model.list.workspaceHasNoDefault) {
    page.push({ key: 'follow', label: 'Use the workspace’s default tabs here', change: { kind: 'follow-default' }, disabled: false });
  }
  if (model.canSetDefault && model.list.refused === null) {
    page.push({ key: 'everywhere', label: 'Use these tabs on every page', change: { kind: 'use-everywhere' }, disabled: false });
  }
  if (page.length > 0) groups.push(page);
  return groups;
}

export function TabMenu({ model, names }: TabMenuProps): JSX.Element | null {
  const groups: MenuItem[][] = tabMenuItems(model, names);
  if (groups.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Tab options"
          title="Tab options"
          disabled={model.busy}
          data-testid="node-tab-menu"
          className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        {groups.map((group: MenuItem[], index: number): JSX.Element => (
          <div key={group[0].key} role="none">
            {index > 0 && <DropdownMenuSeparator />}
            {group.map((item: MenuItem): JSX.Element => (
              <DropdownMenuItem
                key={item.key}
                disabled={item.disabled}
                className="min-h-[44px]"
                data-testid={`node-tab-menu-${item.key}`}
                // A refused or failed change is toasted by `change` itself (use-node-tabs.ts).
                onSelect={(): void => { void model.change(item.change); }}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
