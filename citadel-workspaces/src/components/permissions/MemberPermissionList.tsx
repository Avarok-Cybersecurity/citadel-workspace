/**
 * One member's permissions at one level, each with where it comes from.
 *
 * A grant from a level above is shown ticked and locked, with the level named:
 * it reaches this level whatever is set here, so the place to change it is
 * there. Everything else is editable, and a row that Save would change says so.
 */
import { ChevronRight, Lock } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { PERMISSION_CATEGORIES, type PermissionDefinition } from './permission-constants';
import { levelPhrase, type GrantSource, type PermissionLevel } from './member-permission-path';
import type { MemberPermissionEditor } from './use-member-permission-editor';

/** The path from the workspace down to the level being edited, which is marked as the current one. */
export function MemberPermissionPathBar({ path }: { path: readonly PermissionLevel[] }): JSX.Element {
  return (
    <ol aria-label="Where these permissions apply" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs" data-testid="member-permissions-path">
      {path.map((level: PermissionLevel, index: number) => {
        const current: boolean = index === path.length - 1;
        return (
          <li key={level.id} className="flex min-w-0 items-center gap-1" aria-current={current ? 'location' : undefined}>
            {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className={cn('min-w-0 truncate rounded px-1.5 py-0.5', current ? 'bg-primary-accent/15 font-semibold text-foreground' : 'text-muted-foreground')}>
              <span className="uppercase tracking-wider">{level.kind}</span> {level.name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function sourceText(source: GrantSource | null): string | null {
  if (source === null || source.kind === 'none') return null;
  if (source.kind === 'here') return 'Granted here';
  return `From ${levelPhrase(source.from)} — change it there`;
}

function PermissionRow({ permission, editor }: { permission: PermissionDefinition; editor: MemberPermissionEditor }): JSX.Element {
  const source: GrantSource | null = editor.sourceOf(permission.id);
  const inherited: boolean = source?.kind === 'inherited';
  const checked: boolean = editor.isChecked(permission.id);
  const adding: boolean = editor.changes.added.includes(permission.id);
  const removing: boolean = editor.changes.removed.includes(permission.id);
  const from: string | null = sourceText(source);
  const inputId: string = `member-permission-${permission.id}`;
  return (
    <div className={cn('flex items-start gap-3 rounded-md px-2 py-2', (adding || removing) && 'bg-primary-accent/10')} data-testid={`member-permission-row-${permission.id}`}>
      <Checkbox
        id={inputId}
        checked={checked}
        disabled={!editor.ready || inherited}
        onCheckedChange={() => editor.toggle(permission.id)}
        aria-describedby={`${inputId}-about`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="flex flex-wrap items-center gap-x-2 text-sm font-medium leading-[24px] text-foreground">
          {permission.label}
          {adding && <span className="text-xs font-semibold text-success-emphasis">Will be granted</span>}
          {removing && <span className="text-xs font-semibold text-destructive-emphasis">Will be removed</span>}
        </label>
        <p id={`${inputId}-about`} className="text-xs text-muted-foreground">
          {permission.description}
          {from !== null && (
            <span className="mt-0.5 flex items-center gap-1 text-foreground/80">
              {inherited && <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />}
              {from}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/** Every permission, grouped as the canonical categories group them. */
export function MemberPermissionList({ editor }: { editor: MemberPermissionEditor }): JSX.Element {
  return (
    <div className="space-y-4">
      {Object.entries(PERMISSION_CATEGORIES).map(([category, permissions]: [string, PermissionDefinition[]]) => (
        <fieldset key={category}>
          <legend className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-primary-accent">{category}</legend>
          {permissions.map((permission: PermissionDefinition) => (
            <PermissionRow key={permission.id} permission={permission} editor={editor} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
