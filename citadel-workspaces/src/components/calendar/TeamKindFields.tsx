/**
 * A team type's hosts and, for a round robin, how the host is chosen (design §3.6.2): the node's
 * members to tick, the three strategies said in words, and a weight per host when the strategy is
 * priority. Errors sit under their field, as `checkKind` (event-type-kind.ts) reports them.
 */
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import type { KindDraft, StrategyName } from '@/lib/calendar/event-type-kind';
import { MAX_COLLECTIVE_HOSTS } from '@/lib/calendar/event-type-kind';

interface TeamKindFieldsProps {
  draft: KindDraft;
  /** Who may host: the node's members, by username. */
  members: readonly string[];
  errors: ReadonlyMap<string, string>;
  onChange: (next: KindDraft) => void;
}

const STRATEGY: Record<StrategyName, string> = {
  equal: 'Spread evenly: whoever has the fewest bookings this month',
  priority: 'By priority: the highest weight first',
  availability: 'By availability: the first host in the list who is free',
};
const CHOICE: string = 'flex min-h-[44px] min-w-0 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';

export function TeamKindFields({ draft, members, errors, onChange }: TeamKindFieldsProps): JSX.Element {
  const base: string = useId();
  const hostsError: string | undefined = errors.get('hosts');
  const weightsError: string | undefined = errors.get('weights');
  const toggle = (who: string, on: boolean): void => onChange({ ...draft, hosts: on ? [...draft.hosts, who] : draft.hosts.filter((h: string) => h !== who) });
  const candidates: string[] = [...new Set([...members, ...draft.hosts])];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={hostsError === undefined ? undefined : `${base}-hosts-error`}>
        <legend className="mb-1 text-sm font-semibold text-foreground">
          Hosts{draft.kind === 'collective' ? ` (2 to ${MAX_COLLECTIVE_HOSTS}, all free at once)` : ' (2 or more)'}
        </legend>
        {candidates.length === 0 && <p className="text-sm text-muted-foreground">Nobody here can host yet.</p>}
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {candidates.map((who: string) => (
            <label key={who} className={CHOICE}>
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.hosts.includes(who)} onChange={(e): void => toggle(who, e.target.checked)} />
              <span className="min-w-0 truncate">{who}</span>
            </label>
          ))}
        </div>
        {hostsError !== undefined && <p id={`${base}-hosts-error`} className="text-sm text-destructive-emphasis">{hostsError}</p>}
      </fieldset>
      {draft.kind === 'round_robin' && (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-foreground">Who takes a booking</legend>
          {(Object.keys(STRATEGY) as StrategyName[]).map((s: StrategyName) => (
            <label key={s} className={CHOICE}>
              <input type="radio" name={`${base}-strategy`} className="h-4 w-4 shrink-0 accent-primary" checked={draft.strategy === s} onChange={(): void => onChange({ ...draft, strategy: s })} />
              <span className="min-w-0">{STRATEGY[s]}</span>
            </label>
          ))}
        </fieldset>
      )}
      {draft.kind === 'round_robin' && draft.strategy === 'priority' && draft.hosts.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={weightsError === undefined ? undefined : `${base}-weights-error`}>
          <legend className="mb-1 text-sm font-semibold text-foreground">Weights (higher is asked first)</legend>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {draft.hosts.map((who: string) => (
              <div key={who} className="flex min-w-0 items-center gap-2">
                <label htmlFor={`${base}-w-${who}`} className="min-w-0 flex-1 truncate text-sm text-foreground">{who}</label>
                <Input id={`${base}-w-${who}`} inputMode="numeric" className="h-[44px] w-[96px]" value={draft.weights[who] ?? ''} aria-invalid={weightsError !== undefined}
                  onChange={(e): void => onChange({ ...draft, weights: { ...draft.weights, [who]: e.target.value } })} />
              </div>
            ))}
          </div>
          {weightsError !== undefined && <p id={`${base}-weights-error`} className="text-sm text-destructive-emphasis">{weightsError}</p>}
        </fieldset>
      )}
    </div>
  );
}
