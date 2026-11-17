/**
 * The pages above a node, nearest first, named as the member's tree names them: what an event can
 * also be shown on (design 3.5). Read through the Calendar's own `nodes.read` port, so it is the
 * chain the up-pull will match; a chain that cannot be read offers no page above, and says why on
 * the console.
 */
import { useEffect, useState } from 'react';
import type { CalendarPorts } from '@/lib/calendar/ports';
import { chainOf } from '@/lib/calendar/tree-walk';
import type { NamedNode } from './PropagationFields';

export function useAbove(ports: CalendarPorts, node: string, nodeName: (id: string) => string): readonly NamedNode[] {
  const [chain, setChain] = useState<readonly string[]>([]);
  useEffect(() => {
    let live: boolean = true;
    chainOf(ports, node).then((read: string[]): void => { if (live) setChain(read.slice(1)); }, (error: unknown): void => {
      console.warn('[calendar] the pages above could not be read', error);
      if (live) setChain([]);
    });
    return (): void => { live = false; };
  }, [ports, node]);
  return chain.map((id: string) => ({ id, name: nodeName(id) }));
}
