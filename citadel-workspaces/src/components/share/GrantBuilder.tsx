/**
 * "Who can open it": the grants chosen, as removable chips, and the ways to add one. Anyone a
 * chip names may open the link; a group's members are copied as of now, and the note says so.
 */
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { withMember, withoutMember, withRole, withoutRole, type GrantDraft } from '@/lib/share/grant-draft';
import type { ShareTarget } from '@/lib/share/share-target';
import { BookingGuestsField, GUEST_COPY } from './BookingGuestsField';

export interface RoleOption {
  id: string;
  name: string;
}

interface GrantBuilderProps {
  draft: GrantDraft;
  onChange: (draft: GrantDraft) => void;
  /** Usernames that can be named, the sharer left out. */
  members: readonly string[];
  roles: readonly RoleOption[];
  target: ShareTarget;
  disabled: boolean;
}

function Chip({ label, onRemove, disabled }: { label: string; onRemove: () => void; disabled: boolean }): JSX.Element {
  return (
    <li className="flex min-h-8 max-w-full items-center gap-1 rounded-full border border-border bg-surface/60 py-0.5 pl-3 pr-1 text-xs" data-testid="share-grant-chip">
      <span className="min-w-0 truncate">{label}</span>
      <Button type="button" variant="ghost" size="icon" className="tap-target h-6 w-6 shrink-0 rounded-full" disabled={disabled}
        onClick={onRemove} aria-label={`Remove ${label}`} data-testid="share-grant-remove">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

function AddToggle({ label, onAdd, disabled, testId }: { label: string; onAdd: () => void; disabled: boolean; testId: string }): JSX.Element {
  return (
    <Button type="button" variant="outline" size="sm" className="h-8 max-w-full gap-1 text-xs" disabled={disabled} onClick={onAdd} data-testid={testId}>
      <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{label}</span>
    </Button>
  );
}

export function GrantBuilder({ draft, onChange, members, roles, target, disabled }: GrantBuilderProps): JSX.Element {
  const nameOfRole = (id: string): string => roles.find((r: RoleOption) => r.id === id)?.name ?? id;
  const nodeLabel: string = `Anyone who can see “${target.label}”`;
  const groupLabel: string | null = target.group === null ? null : `Members of ${target.group.name} (as of now)`;
  const addableMembers: string[] = members.filter((m: string) => !draft.members.includes(m));
  const addableRoles: RoleOption[] = roles.filter((r: RoleOption) => !draft.roles.includes(r.id));

  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">Who can open it</legend>
      <ul className="flex flex-wrap gap-1.5" aria-label="People and groups this link opens for" data-testid="share-grants">
        {draft.members.map((m: string) => <Chip key={`m-${m}`} label={m} disabled={disabled} onRemove={() => onChange(withoutMember(draft, m))} />)}
        {draft.roles.map((r: string) => <Chip key={`r-${r}`} label={`Role: ${nameOfRole(r)}`} disabled={disabled} onRemove={() => onChange(withoutRole(draft, r))} />)}
        {draft.nodeViewers !== null && <Chip label={nodeLabel} disabled={disabled} onRemove={() => onChange({ ...draft, nodeViewers: null })} />}
        {draft.workspace && <Chip label="Everyone in the workspace" disabled={disabled} onRemove={() => onChange({ ...draft, workspace: false })} />}
        {draft.group !== null && groupLabel !== null && <Chip label={groupLabel} disabled={disabled} onRemove={() => onChange({ ...draft, group: null })} />}
        {draft.booking !== null && <Chip label={GUEST_COPY.add} disabled={disabled} onRemove={() => onChange({ ...draft, booking: null })} />}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Select value="" onValueChange={(m: string) => onChange(withMember(draft, m))} disabled={disabled || addableMembers.length === 0}>
          <SelectTrigger aria-label="Add a person" className="h-8 w-auto min-w-[8.5rem] text-xs" data-testid="share-add-member">
            <SelectValue placeholder={addableMembers.length === 0 ? 'No one else to add' : 'Add a person'} />
          </SelectTrigger>
          <SelectContent>{addableMembers.map((m: string) => <SelectItem key={m} value={m} data-testid={`share-member-option-${m}`}>{m}</SelectItem>)}</SelectContent>
        </Select>
        {roles.length > 0 && (
          <Select value="" onValueChange={(r: string) => onChange(withRole(draft, r))} disabled={disabled || addableRoles.length === 0}>
            <SelectTrigger aria-label="Add a role" className="h-8 w-auto min-w-[7.5rem] text-xs" data-testid="share-add-role">
              <SelectValue placeholder="Add a role" />
            </SelectTrigger>
            <SelectContent>{addableRoles.map((r: RoleOption) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {!draft.workspace && <AddToggle label="Everyone in the workspace" disabled={disabled} testId="share-add-workspace" onAdd={() => onChange({ ...draft, workspace: true })} />}
        {target.nodeId !== null && draft.nodeViewers === null && (
          <AddToggle label={nodeLabel} disabled={disabled} testId="share-add-node-viewers" onAdd={() => onChange({ ...draft, nodeViewers: target.nodeId })} />
        )}
        {target.group !== null && draft.group === null && groupLabel !== null && (
          <AddToggle label={groupLabel} disabled={disabled} testId="share-add-group"
            onAdd={() => { if (target.group) onChange({ ...draft, group: { groupId: target.group.groupId, members: target.group.members } }); }} />
        )}
        {target.booking !== null && draft.booking === null && (
          <AddToggle label={GUEST_COPY.add} disabled={disabled} testId="share-add-booking-guests"
            onAdd={() => { if (target.booking) onChange({ ...draft, booking: { ...target.booking, maxGuests: null } }); }} />
        )}
      </div>
      <BookingGuestsField draft={draft} onChange={onChange} disabled={disabled} />
      {draft.group !== null && (
        <p className="text-xs text-muted-foreground" data-testid="share-group-snapshot-note">
          {`The ${draft.group.members.length} people in the group now. Anyone who joins later is not included.`}
        </p>
      )}
    </fieldset>
  );
}
