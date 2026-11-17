/**
 * Where a routing rule, or a form's fallback, sends the booker (design §3.6.3): a member's page on
 * this node, one of this node's team types, or another node, given by its id, which the booker
 * reaches as a link if they can see it. Nothing is chosen for the editor: an unchosen target is
 * said by the form's check (routing-form-draft.ts).
 */
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { RoutingTarget } from '@/lib/calendar/generated/RoutingTarget';
import { TARGET_KINDS, targetKind, unchosen, type TargetKind } from '@/lib/calendar/routing-form-draft';
import { NativeSelect } from './NativeSelect';

interface RoutingTargetPickerProps {
  legend: string;
  target: RoutingTarget;
  node: { id: string; name: string };
  members: readonly string[];
  teams: readonly EventType[];
  error: string | undefined;
  onChange: (next: RoutingTarget) => void;
}

const KIND_LABEL: Record<TargetKind, string> = { member: 'A member here', team_type: 'A team type here', node: 'Another node' };

export function RoutingTargetPicker({ legend, target, node, members, teams, error, onChange }: RoutingTargetPickerProps): JSX.Element {
  const base: string = useId();
  const kind: TargetKind = targetKind(target);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={error === undefined ? undefined : `${base}-error`}>
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        <NativeSelect aria-label={`${legend}: kind`} className="w-full sm:w-auto" value={kind} onChange={(e): void => onChange(unchosen(e.target.value as TargetKind, node.id))}>
          {TARGET_KINDS.map((k: TargetKind) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </NativeSelect>
        {'member' in target && (
          <NativeSelect aria-label={`${legend}: member`} className="w-full min-w-0 sm:w-auto sm:flex-1" value={target.member.username}
            onChange={(e): void => onChange({ member: { username: e.target.value, slug: node.id } })}>
            <option value="">Choose a member</option>
            {members.map((m: string) => <option key={m} value={m}>{m}</option>)}
          </NativeSelect>
        )}
        {'team_type' in target && (
          <NativeSelect aria-label={`${legend}: team type`} className="w-full min-w-0 sm:w-auto sm:flex-1" value={target.team_type.type_id}
            onChange={(e): void => onChange({ team_type: { node_id: node.id, type_id: e.target.value } })}>
            <option value="">{teams.length === 0 ? `${node.name} has no team types yet` : 'Choose a team type'}</option>
            {teams.map((t: EventType) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        )}
        {'node' in target && (
          <Input aria-label={`${legend}: node id`} placeholder="Node id" className="h-[44px] w-full min-w-0 sm:w-auto sm:flex-1" value={target.node.node_id}
            onChange={(e): void => onChange({ node: { node_id: e.target.value } })} />
        )}
      </div>
      {error !== undefined && <p id={`${base}-error`} role="alert" className="text-sm text-destructive-emphasis">{error}</p>}
    </fieldset>
  );
}
