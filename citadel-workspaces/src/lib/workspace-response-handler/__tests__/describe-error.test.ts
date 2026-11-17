/**
 * What a refusal says to the person who hit it.
 *
 * A permission denial rendered as `PermissionDenied: EditTreeStructure
 * required` — the enum name, in a toast, to somebody who has never seen the
 * permission matrix. It reads like compiler output, and it does not say the one
 * thing that helps: ask an administrator. The permission NAMES also differ from
 * the labels that matrix shows, so even a user who had seen that screen could
 * not match the two.
 */

import { describe, it, expect } from 'vitest';
import { describeRefusal, describeWorkspaceError, PERMISSION_SENTENCE } from '../describe-error';

describe('a workspace error', () => {
  it('turns a permission denial into a sentence with a next step', () => {
    const message: string = describeWorkspaceError({
      PermissionDenied: 'EditTreeStructure required',
    });

    expect(message).not.toMatch(/EditTreeStructure/);
    expect(message).toMatch(/administrator/i);
  });

  it('names no enum variant for any permission it knows', () => {
    for (const permission of [
      'EditMdx',
      'EditTreeStructure',
      'ManageMembers',
      'ManagePermissions',
      'ViewContent',
      'SendMessages',
      'ManageWorkspace',
    ]) {
      const message: string = describeWorkspaceError({
        PermissionDenied: `${permission} required`,
      });
      expect(message, permission).not.toMatch(new RegExp(permission));
    }
  });

  it('still says something useful for a permission it does not know', () => {
    // A new permission must not fall through to the raw variant name.
    const message: string = describeWorkspaceError({ PermissionDenied: 'SomeFuturePermission' });

    expect(message).not.toMatch(/SomeFuturePermission/);
    expect(message).toMatch(/permission/i);
  });

  it('passes other errors through, because their detail is the only clue', () => {
    expect(describeWorkspaceError({ NotFound: 'no such office' })).toBe(
      'NotFound: no such office',
    );
    expect(describeWorkspaceError('Workspace not found')).toBe('Workspace not found');
  });

  it('does not render an object as [object Object]', () => {
    expect(describeWorkspaceError({ SomeVariant: { nested: true } })).toBe('SomeVariant');
    expect(describeWorkspaceError(null)).toBe('The server rejected the request.');
  });
});

/**
 * The same refusals when they arrive as the server's `Error(String)` response,
 * which is how every member write answers. The strings are the kernel's own
 * (async_domain_server_ops.rs, async_process_command.rs), verbatim.
 */
describe('a refusal string', () => {
  it('turns the AddUsers denial into the sentence the Add button already uses', () => {
    expect(
      describeRefusal('Failed to add member: Permission denied: AddUsers is required to manage members'),
    ).toBe(PERMISSION_SENTENCE.AddUsers);
  });

  it('says a role above your own cannot be given, without the enum names', () => {
    for (const refusal of [
      'Failed to add member: Permission denied: Admin cannot grant Owner, which is above them',
      'Failed to add member: Permission denied: Custom("helper", 21) cannot grant Admin, which carries authority it does not hold',
    ]) {
      const message: string = describeRefusal(refusal);
      expect(message, refusal).toBe('You cannot give someone a role above your own.');
    }
  });

  it('says a higher-ranked member cannot be changed', () => {
    expect(
      describeRefusal('Failed to add member: Permission denied: Owner cannot change the role of alice, who is above them'),
    ).toBe('You cannot change the role of someone who outranks you.');
  });

  it('keeps a refusal that is already a sentence, minus the handler prefix', () => {
    expect(
      describeRefusal("Failed to add member: No account named 'bobb' exists on this workspace"),
    ).toBe("No account named 'bobb' exists on this workspace");
  });

  it('never shows "Permission denied:" for a denial it has no sentence for', () => {
    const message: string = describeRefusal('Failed to add member: Permission denied: unknown actor');
    expect(message).not.toMatch(/Permission denied/);
    expect(message).toMatch(/permission/i);
  });
});
