/**
 * The members tab shows a banned member as banned, in place of a role they no longer hold, and
 * offers to lift the ban; anyone else it offers to ban. Real MemberRow; the rules are passed in, as
 * the tab passes them.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberRow, type MemberRowRules } from '../MemberRow';
import type { MemberData } from '../../types';
import { SEED } from '@/test-utils/role-table';

const RULES: MemberRowRules = { roles: SEED.roles, assignable: new Set(['member', 'guest']), isOnlyManager: false, actOnBlocked: null, banBlocked: null };

function row(member: MemberData, onSetBanned: Mock | undefined, rules: MemberRowRules = RULES): void {
  render(
    <MemberRow member={member} showAdvanced={false} isUpdatingRole={false} rules={rules}
      onRoleChange={() => undefined} onAdvancedPermissions={() => undefined} onRemove={() => undefined} onSetBanned={onSetBanned} />,
  );
}

const sam: MemberData = { userId: 'sam', username: 'sam', roleId: 'member', banned: false, isGuest: false };
const mal: MemberData = { userId: 'mal', username: 'mal', banned: true, isGuest: false };

afterEach(cleanup);

describe('a member row', () => {
  it('shows a banned member as Banned, without a role picker, and lifts the ban', async () => {
    const onSetBanned: Mock = vi.fn();
    row(mal, onSetBanned);
    expect(screen.getByTestId('member-banned-mal').textContent).toBe('Banned');
    expect(screen.queryByTestId('member-role-select-mal')).toBeNull();
    expect(screen.queryByTestId('member-ban-mal')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Unban mal' }));
    expect(onSetBanned).toHaveBeenCalledWith(mal, false);
  });

  it('offers to ban a member in good standing', async () => {
    const onSetBanned: Mock = vi.fn();
    row(sam, onSetBanned);
    expect(screen.queryByTestId('member-banned-sam')).toBeNull();
    expect(screen.getByTestId('member-role-select-sam')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ban sam' }));
    expect(onSetBanned).toHaveBeenCalledWith(sam, true);
  });

  it('holds the control back when the ladder says no, and says why', () => {
    row(sam, vi.fn(), { ...RULES, banBlocked: 'Their role is not below yours.' });
    expect((screen.getByTestId('member-ban-sam') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers no ban where the tab passes none: a node roster, since a ban is workspace-wide', () => {
    row(sam, undefined);
    expect(screen.queryByTestId('member-ban-sam')).toBeNull();
  });
});
