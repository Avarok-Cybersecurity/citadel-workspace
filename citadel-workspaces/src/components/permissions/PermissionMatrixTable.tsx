/**
 * The role × permission grid: one column per role in the live table, one row per permission.
 *
 * A column the reader may edit is a column of checkboxes; any other column is a column of
 * marks, a tick or a dash with its meaning in words. Which is which is the ladder's call
 * (editor-rules.ts): the Owner's column is always marks, as is every role at or above yours, and
 * so is the whole grid for anyone without Manage roles.
 *
 * The accessibility work is the substance here: Radix renders a checkbox as a <button> with no
 * text, so a matrix of them announced dozens of identical "checkbox, not checked" with nothing
 * to tell them apart. Each box and each mark is named outright, role and permission, rather than
 * left to table semantics, which only help a reader in table mode. The headers are correct too
 * (`scope`, and the permission cell as a `th`), so both routes work.
 */
import React from 'react';
import { Check, Lock, Minus } from 'lucide-react';
import type { Permission as WirePermission, RoleDefinition } from 'citadel-workspace-client-ts';
import { Checkbox } from '@/components/ui/checkbox';
import type { CellState } from '@/lib/workspace-roles/editor-rules';
import { RoleDot } from './RoleDot';
import { scrollToShowClear, type Edges } from './sticky-clearance';
import { documentMotionTier } from '@/lib/motion-state';
import { motionTier } from '@/lib/motion-tier';
import type { PermissionDefinition } from './permission-constants';

interface PermissionMatrixTableProps {
  allPermissions: [string, PermissionDefinition[]][];
  roles: readonly RoleDefinition[];
  cell: (role: RoleDefinition, permission: WirePermission) => CellState;
  lockOf: (role: RoleDefinition) => string | null;
  onToggle: (role: RoleDefinition, permission: WirePermission, on: boolean) => void;
}

function Mark({ role, permission, granted }: { role: RoleDefinition; permission: PermissionDefinition; granted: boolean }): JSX.Element {
  // `relative` holds the sr-only text: absolutely positioned, it otherwise belongs to the dialog,
  // and the cells off to the right of the table's own scroller made the whole dialog scroll sideways.
  return (
    <span
      className="relative inline-flex h-[24px] w-[24px] items-center justify-center align-middle"
      data-role-grant={granted ? 'yes' : 'no'}
      data-testid={`role-grant-${role.id}-${permission.id}`}
    >
      {granted
        ? <Check className="h-[16px] w-[16px] text-success-emphasis" aria-hidden="true" />
        : <Minus className="h-[16px] w-[16px] text-muted-foreground" aria-hidden="true" />}
      <span className="sr-only">{`${role.name}: ${granted ? 'can' : 'cannot'} ${permission.label}`}</span>
    </span>
  );
}

// The permission column stays put (sticky) while the role columns scroll under it. The scroller
// keeps that column's width, and the header row's height, clear of whatever is scrolled into view:
// without it, a role's checkbox focused by Tab, or scrolled to, could stop under the permission
// column, focused and invisible (WCAG 2.4.11). Seen at 390px once the table had been scrolled to
// its last column: every Member checkbox then sat behind the permission names; and at any width a
// row scrolled up into view stopped under the header. The column renders at or under its width
// (106px of 132 at 390px), and the header measures 48 to 51px, so the clearances cover both.
const PERMISSION_COLUMN: string = 'w-[132px] sm:w-[200px]';
const PERMISSION_COLUMN_CLEARANCE: string = 'scroll-pl-[132px] sm:scroll-pl-[200px] scroll-pt-[56px]';

/** Focus that landed under the sticky strips or past the edge: the engines' own focus scrolling
 *  does not keep it clear (sticky-clearance.ts). Measured a frame later, once the engine's own
 *  focus scroll has run: in WebKit that scroll, landing after the event, cancelled a smooth
 *  correction started inside it, and the cell stayed out of view. */
function keepFocusClear(event: React.FocusEvent<HTMLDivElement>): void {
  const scroller: HTMLDivElement = event.currentTarget;
  const target: EventTarget = event.target;
  if (!(target instanceof Element) || target.closest('thead, th') !== null) return;
  requestAnimationFrame((): void => {
    const header: Element | null = scroller.querySelector('thead');
    const column: Element | null = scroller.querySelector('thead th');
    if (header === null || column === null || document.activeElement !== target) return;
    const outer: DOMRect = scroller.getBoundingClientRect();
    const viewLeft: number = outer.left + scroller.clientLeft;
    const viewTop: number = outer.top + scroller.clientTop;
    const view: Edges = { left: viewLeft, top: viewTop, right: viewLeft + scroller.clientWidth, bottom: viewTop + scroller.clientHeight };
    const { left, top } = scrollToShowClear(target.getBoundingClientRect(), column.getBoundingClientRect(), header.getBoundingClientRect(), view);
    if (left === 0 && top === 0) return;
    const still: boolean = motionTier(documentMotionTier(), window.matchMedia('(prefers-reduced-motion: reduce)').matches) !== 'full';
    scroller.scrollBy({ left, top, behavior: still ? 'auto' : 'smooth' });
  });
}

export function PermissionMatrixTable({ allPermissions, roles, cell, lockOf, onToggle }: PermissionMatrixTableProps): JSX.Element {
  return (
    <div className={`flex-1 overflow-auto min-h-0 ${PERMISSION_COLUMN_CLEARANCE}`} onFocus={keepFocusClear}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-background">
          <tr>
            <th scope="col" className={`sticky left-0 z-20 bg-background text-left text-xs font-semibold tracking-wider uppercase text-muted-foreground px-3 sm:px-6 py-3 ${PERMISSION_COLUMN} border-b border-border`}>
              Permission
            </th>
            {roles.map((role: RoleDefinition) => {
              const lock: string | null = lockOf(role);
              return (
                <th key={role.id} scope="col" className="text-center px-3 py-3 border-b border-border min-w-[90px]" data-testid={`role-column-${role.id}`}>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-foreground/80">
                    <RoleDot color={role.color} />
                    {role.name}
                    {lock !== null && (
                      <>
                        <Lock className="h-[12px] w-[12px] text-muted-foreground" aria-hidden="true" />
                        <span className="sr-only">{`(read-only: ${lock})`}</span>
                      </>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {allPermissions.map(([category, permissions]) => (
            <React.Fragment key={category}>
              <tr>
                <td colSpan={roles.length + 1} className="sticky left-0 bg-background px-3 sm:px-6 pt-4 pb-1.5">
                  <span className="text-xs font-semibold tracking-wider uppercase text-primary-accent">{category}</span>
                </td>
              </tr>
              {permissions.map((permission: PermissionDefinition) => (
                <tr key={permission.id} className="group hover:bg-primary-accent/5 transition-colors">
                  {/* Addressed by id, not by its words: a spec that hunted for a label stopped
                      finding anything the day the label changed. */}
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background px-3 sm:px-6 py-2 text-left font-normal"
                    data-testid={`permission-row-${permission.id}`}
                  >
                    <span className="text-sm text-foreground/80">{permission.label}</span>
                  </th>
                  {roles.map((role: RoleDefinition) => {
                    const state: CellState = cell(role, permission.id);
                    return (
                      <td key={role.id} className="text-center px-3 py-2">
                        {state.editable ? (
                          <Checkbox
                            checked={state.checked}
                            onCheckedChange={(on: boolean | 'indeterminate'): void => onToggle(role, permission.id, on === true)}
                            aria-label={`${role.name}: ${permission.label}`}
                            className="align-middle"
                            data-testid={`role-grant-${role.id}-${permission.id}`}
                          />
                        ) : (
                          <Mark role={role} permission={permission} granted={state.checked} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
