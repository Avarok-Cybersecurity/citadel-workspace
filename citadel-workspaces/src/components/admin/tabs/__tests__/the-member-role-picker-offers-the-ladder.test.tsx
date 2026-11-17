/**
 * The members tab's role picker, given the rules the ladder decided: it offers only the roles
 * you may hand out (and the member's own, so it stays visible), keeps the last member able to
 * manage roles from being demoted out of it, and is shut when their role is not below yours.
 *
 * Real: MemberRow and the Radix select. Nothing is mocked; the rules are passed in, as the tab
 * passes them.
 */
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoleDefinition } from 'citadel-workspace-client-ts';
import { LAST_MANAGER_REASON, MemberRow, type MemberRowRules } from '../MemberRow';
import { ADMIN, GUEST, MEMBER, OWNER, role } from '@/test-utils/role-table';

/** A role between Admin and Member that may manage roles. */
const LEAD: RoleDefinition = role('role-lead', 250, ['ManageRoles', 'ViewContent'], 'Lead');
const ROLES: RoleDefinition[] = [OWNER, ADMIN, LEAD, MEMBER, GUEST];

function rules(over: Partial<MemberRowRules>): MemberRowRules {
  return { roles: ROLES, assignable: new Set(['role-lead', 'member', 'guest']), isOnlyManager: false, actOnBlocked: null, ...over };
}

function row(roleId: string, given: MemberRowRules, onRoleChange: Mock = vi.fn()): void {
  render(
    <MemberRow member={{ userId: 'sam', username: 'sam', roleId, isGuest: false }} showAdvanced={false} isUpdatingRole={false}
      rules={given} onRoleChange={onRoleChange} onAdvancedPermissions={() => undefined} onRemove={() => undefined} />,
  );
}

const offered = (): string[] => screen.getAllByRole('option').map((o: HTMLElement): string => o.textContent ?? '');
const option = (id: string): HTMLElement => screen.getByTestId(`member-role-option-${id}`);

beforeAll((): void => {
  // jsdom lays nothing out; Radix Select scrolls its chosen item into view.
  Element.prototype.scrollIntoView = (): void => {};
});
afterEach(cleanup);

describe('the member role picker', () => {
  it('offers the roles you may hand out and the member\'s own, and hands over the chosen definition', async () => {
    const onRoleChange: Mock = vi.fn();
    row('admin', rules({}), onRoleChange);
    await userEvent.click(screen.getByTestId('member-role-select-sam'));
    expect(offered()).toEqual(['Admin', 'Lead', 'Member', 'Guest']);
    await userEvent.click(option('guest'));
    expect(onRoleChange).toHaveBeenCalledWith('sam', GUEST);
  });

  it('keeps the last member able to manage roles from a role without it, and says why Remove is shut', async () => {
    row('role-lead', rules({ isOnlyManager: true }));
    expect(screen.getByTestId('member-remove-sam')).toBeDisabled();
    expect(screen.getByTestId('member-remove-sam')).toHaveAttribute('aria-label', LAST_MANAGER_REASON);
    await userEvent.click(screen.getByTestId('member-role-select-sam'));
    expect(option('member')).toHaveAttribute('data-disabled');
    expect(option('guest')).toHaveAttribute('data-disabled');
    expect(option('role-lead')).not.toHaveAttribute('data-disabled');
  });

  it('lets an ordinary member be moved to any role offered', async () => {
    row('member', rules({}));
    await userEvent.click(screen.getByTestId('member-role-select-sam'));
    expect(option('guest')).not.toHaveAttribute('data-disabled');
  });

  it('is shut, with the reason, for a member whose role is not below yours', () => {
    row('admin', rules({ actOnBlocked: 'not below you' }));
    const picker: HTMLElement = screen.getByTestId('member-role-select-sam');
    expect(picker).toBeDisabled();
    expect(picker.closest('[data-testid="blocked-reason"]')).toHaveAttribute('aria-disabled', 'true');
  });

  it('waits for the table rather than offering nothing', () => {
    row('member', rules({ roles: null }));
    expect(screen.getByTestId('member-role-select-sam')).toBeDisabled();
    expect(screen.getByLabelText('Loading roles')).toBeInTheDocument();
  });
});
