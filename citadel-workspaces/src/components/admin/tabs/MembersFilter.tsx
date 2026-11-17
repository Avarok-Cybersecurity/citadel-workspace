/**
 * Everyone or only guests, as two buttons that say how many each shows. A pair of pressed-state
 * buttons rather than a tab list: they filter one list, they do not switch panels.
 */
import { Button } from '@/components/ui/button';
import type { MemberData } from '../types';
import { guestCount, type MembersFilterChoice } from './members-filter';

interface MembersFilterProps {
  members: readonly MemberData[];
  value: MembersFilterChoice;
  onChange: (value: MembersFilterChoice) => void;
}

export function MembersFilter({ members, value, onChange }: MembersFilterProps): JSX.Element {
  const choices: { id: MembersFilterChoice; label: string }[] = [
    { id: 'everyone', label: `Everyone (${members.length})` },
    { id: 'guests', label: `Guests (${guestCount(members)})` },
  ];
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap gap-2" data-testid="members-filter">
      {choices.map((choice) => (
        <Button
          key={choice.id} type="button" size="sm" variant={value === choice.id ? 'default' : 'outline'}
          className="h-[44px] min-w-[44px] px-4" aria-pressed={value === choice.id} aria-controls="members-tab-list"
          onClick={(): void => onChange(choice.id)} data-testid={`members-filter-${choice.id}`}
        >
          {choice.label}
        </Button>
      ))}
    </div>
  );
}
