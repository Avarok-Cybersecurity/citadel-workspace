/**
 * Where else an event shows (design 3.5), in the event editor: on every page below, which only
 * one of the node's own events can be, and on a page above, which any shared event can reach.
 * Each choice says in words what it does; a page above is chosen by name.
 */
import { useId } from 'react';
import type { EventDraft } from '@/lib/calendar/event-draft';
import { NativeSelect } from './NativeSelect';

export interface NamedNode {
  readonly id: string;
  readonly name: string;
}

interface PropagationFieldsProps {
  draft: Pick<EventDraft, 'destination' | 'down' | 'upTo'>;
  nodeName: string;
  /** The pages above this one, nearest first. */
  above: readonly NamedNode[];
  onChange: (patch: Partial<Pick<EventDraft, 'down' | 'upTo'>>) => void;
}

const HERE: string = '';

export function PropagationFields({ draft, nodeName, above, onChange }: PropagationFieldsProps): JSX.Element {
  const base: string = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" data-testid="calendar-propagation">
      <legend className="mb-1 text-sm font-semibold text-foreground">Also show it</legend>
      {draft.destination === 'node' && (
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.down} onChange={(e): void => onChange({ down: e.target.checked })} />
          On every page below {nodeName}
        </label>
      )}
      {above.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${base}-up`} className="text-sm font-medium text-foreground">On a page above</label>
          <NativeSelect id={`${base}-up`} className="w-full" value={draft.upTo ?? HERE} onChange={(e): void => onChange({ upTo: e.target.value === HERE ? null : e.target.value })}>
            <option value={HERE}>No, only here</option>
            {above.map((n: NamedNode) => <option key={n.id} value={n.id}>{n.name} and the pages between</option>)}
          </NativeSelect>
        </div>
      )}
      {draft.destination !== 'node' && above.length === 0 && <p className="text-sm text-muted-foreground">{nodeName} has no pages above it.</p>}
    </fieldset>
  );
}
