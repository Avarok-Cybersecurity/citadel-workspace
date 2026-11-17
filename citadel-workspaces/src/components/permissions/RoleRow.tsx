/**
 * One role in the Roles tab: its colour and name, and what the reader may do to it.
 *
 * Every control is a real button, always visible (no hover-only reveal: on a phone there is no
 * hover), sized in px because the 14px root shrinks rem. A role the reader may not change says
 * why in words beneath its name, not in a tooltip a touch screen never shows.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Palette, Trash2 } from 'lucide-react';
import type { RoleDefinition } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RoleColorPicker } from '@/components/chat/RoleColorPicker';
import type { RoleDraft } from '@/lib/workspace-roles/role-diff';
import { RoleDot } from './RoleDot';

interface RoleRowProps {
  role: RoleDefinition;
  /** The role new members get. */
  isDefault: boolean;
  draft: RoleDraft;
  /** Why this role is read-only for the reader, or null when they may edit it. */
  lock: string | null;
  /** Where one place up / down puts it, or null when it cannot go there. */
  upTo: number | null;
  downTo: number | null;
  busy: boolean;
  onDraft: (next: RoleDraft) => void;
  onMove: (position: number) => void;
  onDelete: () => void;
}

const ICON_BUTTON: string = 'h-[32px] w-[32px] shrink-0';

export function RoleRow({ role, isDefault, draft, lock, upTo, downTo, busy, onDraft, onMove, onDelete }: RoleRowProps): JSX.Element {
  const [colouring, setColouring] = useState<boolean>(false);
  const editable: boolean = lock === null;
  return (
    <li className="rounded-lg border border-border p-3" data-testid={`role-row-${role.id}`}>
      <div className="flex items-center gap-2">
        <RoleDot color={draft.color} />
        <div className="min-w-0 flex-1">
          {editable ? (
            <Input
              value={draft.name}
              maxLength={48}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void => onDraft({ ...draft, name: event.target.value })}
              aria-label={`Name of the ${role.name} role`}
              className="h-[32px]"
              data-testid={`role-name-${role.id}`}
            />
          ) : (
            <span className="block truncate text-sm font-medium text-foreground">{role.name}</span>
          )}
          {isDefault && <p className="mt-1 inline-block rounded border border-border px-[6px] text-xs font-medium text-foreground" data-testid={`role-default-${role.id}`}>New members get this role</p>}
          {lock !== null && <p className="mt-1 text-xs text-muted-foreground" data-testid={`role-lock-${role.id}`}>{lock}</p>}
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON} disabled={busy || upTo === null}
              onClick={(): void => { if (upTo !== null) onMove(upTo); }} aria-label={`Move ${role.name} up`} data-testid={`role-up-${role.id}`}>
              <ArrowUp className="h-[16px] w-[16px]" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON} disabled={busy || downTo === null}
              onClick={(): void => { if (downTo !== null) onMove(downTo); }} aria-label={`Move ${role.name} down`} data-testid={`role-down-${role.id}`}>
              <ArrowDown className="h-[16px] w-[16px]" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON} aria-pressed={colouring}
              onClick={(): void => setColouring(!colouring)} aria-label={`Colour of ${role.name}`} data-testid={`role-colour-${role.id}`}>
              <Palette className="h-[16px] w-[16px]" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className={`${ICON_BUTTON} text-destructive hover:text-destructive`} disabled={busy}
              onClick={onDelete} aria-label={`Delete ${role.name}`} data-testid={`role-delete-${role.id}`}>
              <Trash2 className="h-[16px] w-[16px]" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      {editable && colouring && (
        <div className="mt-3">
          <RoleColorPicker color={draft.color ?? ''} onChange={(color: string): void => onDraft({ ...draft, color: color === '' ? null : color })} />
        </div>
      )}
    </li>
  );
}
