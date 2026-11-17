/**
 * What a node pane says about its tabs when they are not simply there: a stored list the client
 * cannot read (said to everyone, since everyone is missing those tabs), and, to whoever may set
 * it, that the workspace has never been given default tabs. Nothing invents a default; this is
 * where an administrator learns there is none, and can make this page's tabs the default.
 */
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NodeTab } from '@/lib/node-tabs/tab-list';
import type { NodeTabsModel } from './use-node-tabs';

export function TabNotices({ model }: { model: NodeTabsModel }): JSX.Element | null {
  const { list } = model;
  const askDefault: boolean = list.workspaceHasNoDefault && model.canSetDefault && list.source !== 'node';
  if (list.refused === null && !askDefault) return null;
  const hasAppTabs: boolean = list.tabs.some((tab: NodeTab): boolean => tab.kind === 'app');
  return (
    <div role="status" data-testid="node-tab-notice" className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] border-b border-border bg-muted/40 px-[16px] py-[8px] text-sm text-muted-foreground">
      <Info aria-hidden className="h-[16px] w-[16px] flex-shrink-0" />
      {list.refused !== null ? (
        <span className="min-w-0 flex-1">This page’s app tabs could not be read ({list.refused}), so only its page{list.tabs.length > 1 ? ' and chat are' : ' is'} shown.</span>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            This workspace has no default tabs yet, so pages show only their page and chat.
            {hasAppTabs ? '' : ' Add apps here with +, then make them every page’s default.'}
          </span>
          {hasAppTabs && (
            <Button variant="outline" size="sm" className="min-h-[44px]" disabled={model.busy} data-testid="node-tab-set-default" onClick={(): void => { void model.change({ kind: 'use-everywhere' }); /* a failure is toasted by `change` */ }}>
              Use these tabs on every page
            </Button>
          )}
        </>
      )}
    </div>
  );
}
