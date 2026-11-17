/**
 * Where to install: "Just for me", or "Workspace…", which opens the wider choices -- everyone,
 * this page, this page and the pages below it, chosen people. A choice the person cannot make is
 * shown disabled with its reason as visible text (a phone never shows a hover title).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ScopeChoice, ScopeOption } from '@/lib/citadel-apps/scope-options';

export interface ScopeSelection {
  choice: ScopeChoice | null;
  people: string[];
}

interface ScopePickerProps {
  options: readonly ScopeOption[];
  nodeName: string | null;
  /** Members who may be chosen, the installer left out. */
  members: readonly string[];
  selection: ScopeSelection;
  onSelect: (selection: ScopeSelection) => void;
  onContinue: () => void;
  onBack: () => void;
}

const WIDE: readonly ScopeChoice[] = ['workspace', 'node', 'node_tree', 'users'];

export function scopeLabel(choice: ScopeChoice, nodeName: string | null): string {
  const page: string = nodeName === null ? 'this page' : `“${nodeName}”`;
  switch (choice) {
    case 'self': return 'Just for me';
    case 'workspace': return 'Everyone in the workspace';
    case 'node': return `Everyone on ${page}`;
    case 'node_tree': return `Everyone on ${page} and the pages below it`;
    case 'users': return 'Chosen people';
  }
}

export const selectionReady = (s: ScopeSelection): boolean => s.choice !== null && (s.choice !== 'users' || s.people.length > 0);

function Choice({ option, label, checked, onPick }: { option: ScopeOption; label: string; checked: boolean; onPick: () => void }): JSX.Element {
  const id: string = `apps-scope-${option.choice}`;
  return (
    <li className="flex flex-col">
      <label htmlFor={id} className={`flex min-h-[44px] items-center gap-[10px] rounded-md px-[8px] ${option.enabled ? 'cursor-pointer hover:bg-muted/50' : 'cursor-not-allowed opacity-70'}`}>
        <input id={id} type="radio" name="apps-scope" className="h-[18px] w-[18px] shrink-0" checked={checked} disabled={!option.enabled} onChange={onPick} data-testid={id} />
        <span className="break-words text-sm text-foreground">{label}</span>
      </label>
      {option.reason !== null && <p className="break-words pl-[30px] text-xs text-muted-foreground" data-testid={`${id}-reason`}>{option.reason}</p>}
    </li>
  );
}

export function ScopePicker({ options, nodeName, members, selection, onSelect, onContinue, onBack }: ScopePickerProps): JSX.Element {
  const [expanded, setExpanded] = useState<boolean>(selection.choice !== null && selection.choice !== 'self');
  const option = (choice: ScopeChoice): ScopeOption => options.find((o: ScopeOption) => o.choice === choice) as ScopeOption;
  const pick = (choice: ScopeChoice): void => onSelect({ choice, people: choice === 'users' ? selection.people : [] });
  const togglePerson = (name: string): void => onSelect({
    choice: 'users',
    people: selection.people.includes(name) ? selection.people.filter((p: string) => p !== name) : [...selection.people, name],
  });
  return (
    <section className="flex flex-col gap-[12px]" data-testid="apps-scope-picker">
      <fieldset className="flex flex-col gap-[4px]">
        <legend className="mb-[4px] text-sm font-medium text-foreground">Who gets this app?</legend>
        <ul className="flex flex-col gap-[2px]">
          <Choice option={option('self')} label={scopeLabel('self', nodeName)} checked={selection.choice === 'self'} onPick={() => pick('self')} />
        </ul>
        <Button variant="ghost" className="min-h-[44px] justify-start" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} data-testid="apps-scope-wider">
          Workspace…
        </Button>
        {expanded && (
          <ul className="flex flex-col gap-[2px] pl-[12px]" data-testid="apps-scope-wide-choices">
            {WIDE.map((choice: ScopeChoice) => (
              <Choice key={choice} option={option(choice)} label={scopeLabel(choice, nodeName)} checked={selection.choice === choice} onPick={() => pick(choice)} />
            ))}
          </ul>
        )}
      </fieldset>
      {selection.choice === 'users' && (
        <fieldset className="flex flex-col gap-[2px]" data-testid="apps-scope-people">
          <legend className="mb-[4px] text-sm font-medium text-foreground">Choose people</legend>
          {members.length === 0 && <p className="text-sm text-muted-foreground">There is nobody else in this workspace yet.</p>}
          <ul className="flex max-h-60 flex-col overflow-y-auto">
            {members.map((name: string) => (
              <li key={name}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-[10px] px-[8px]">
                  <input type="checkbox" className="h-[18px] w-[18px] shrink-0" checked={selection.people.includes(name)} onChange={() => togglePerson(name)} />
                  <span className="break-all text-sm text-foreground">{name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="flex flex-wrap gap-[8px]">
        <Button variant="outline" className="min-h-[44px]" onClick={onBack}>Back</Button>
        <Button className="min-h-[44px]" onClick={onContinue} disabled={!selectionReady(selection)} data-testid="apps-scope-continue">Continue</Button>
      </div>
    </section>
  );
}
