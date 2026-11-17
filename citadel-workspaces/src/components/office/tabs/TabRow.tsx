/**
 * The row of a node pane's tabs: Page, Chat when the node has it, its app tabs in stored order,
 * then the controls that are not tabs (the tab menu and "+"), and whatever the pane puts at the
 * end (the call controls).
 *
 * With more tabs than fit, the row scrolls sideways with snap points and a fade at whichever
 * edge hides more; no tab is folded into a menu, so none disappears on a narrow screen. Every
 * target is at least 44px, in px rather than rem (the root font is 14px, so `h-11` is 38.5px).
 * The menu and "+" sit outside the scrolling list, so they stay in reach however far it scrolls.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, MessageSquare, Plus, Blocks } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { NodeTab } from '@/lib/node-tabs/tab-list';
import type { AppTabName } from './use-app-tab-names';

export const TAB_TRIGGER_CLASS: string =
  'relative h-[44px] min-w-[72px] snap-start rounded-none border-b-2 border-transparent bg-transparent px-[12px] py-0 text-sm font-medium text-muted-foreground shadow-none hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none';

interface TabRowProps {
  tabs: readonly NodeTab[];
  names: ReadonlyMap<string, AppTabName>;
  /** The tab menu, when this person may change something about the tabs. */
  menu: ReactNode;
  /** Opens the marketplace to add a tab; absent when this person may not add one. */
  onAdd: (() => void) | null;
  trailing: ReactNode;
}

type Edges = { start: boolean; end: boolean };

/** Which edges of the scroller hide tabs, kept current as it scrolls and resizes. */
function useHiddenEdges(scroller: React.RefObject<HTMLDivElement>): Edges {
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });
  useEffect(() => {
    const el: HTMLDivElement | null = scroller.current;
    if (el === null) return undefined;
    const measure = (): void => {
      const next: Edges = { start: el.scrollLeft > 1, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
      setEdges((prev: Edges) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer: ResizeObserver | null = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return (): void => { el.removeEventListener('scroll', measure); observer?.disconnect(); };
  }, [scroller]);
  return edges;
}

function fade(edges: Edges): string | undefined {
  if (!edges.start && !edges.end) return undefined;
  const from: string = edges.start ? 'transparent 0, #000 24px' : '#000 0';
  const to: string = edges.end ? '#000 calc(100% - 24px), transparent 100%' : '#000 100%';
  return `linear-gradient(to right, ${from}, ${to})`;
}

function TabLabel({ tab, names }: { tab: NodeTab; names: ReadonlyMap<string, AppTabName> }): JSX.Element {
  if (tab.kind === 'content') return <><FileText aria-hidden className="mr-[8px] h-[16px] w-[16px]" />Page</>;
  if (tab.kind === 'chat') return <><MessageSquare aria-hidden className="mr-[8px] h-[16px] w-[16px]" />Chat</>;
  const name: AppTabName | undefined = names.get(tab.appId);
  return (
    <>
      <Blocks aria-hidden className="mr-[8px] h-[16px] w-[16px]" />
      <span>{name?.label ?? tab.appId}</span>
    </>
  );
}

export function TabRow({ tabs, names, menu, onAdd, trailing }: TabRowProps): JSX.Element {
  const scroller: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const edges: Edges = useHiddenEdges(scroller);
  const mask: string | undefined = fade(edges);
  return (
    <div className="flex min-w-0 flex-shrink-0 items-stretch gap-[4px] border-b border-border px-[8px] sm:px-[16px]" data-testid="node-tab-row">
      <div
        ref={scroller}
        className="min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask === undefined ? undefined : { maskImage: mask, WebkitMaskImage: mask }}
        data-testid="node-tab-scroller"
      >
        <TabsList aria-label="Page tabs" className="h-auto justify-start gap-0 rounded-none bg-transparent p-0">
          {tabs.map((tab: NodeTab): JSX.Element => (
            <TabsTrigger key={tab.key} value={tab.key} className={TAB_TRIGGER_CLASS} data-testid={`node-tab-${tab.key}`}>
              <TabLabel tab={tab} names={names} />
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {menu}
      {onAdd !== null && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add a tab"
          title="Add a tab"
          data-testid="node-tab-add"
          className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus aria-hidden className="h-[18px] w-[18px]" />
        </button>
      )}
      {trailing}
    </div>
  );
}
