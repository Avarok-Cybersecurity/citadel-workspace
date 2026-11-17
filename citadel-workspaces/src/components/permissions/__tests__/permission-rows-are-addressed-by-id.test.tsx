/**
 * The permission rows must be findable by something that does not change when
 * somebody improves the wording.
 *
 * `permission-matrix-phone.spec.ts` guards one thing: that at 375px the label
 * column stays on screen instead of sliding off the left edge, where the
 * permission names become unreachable. To measure that it first has to find a
 * row. It found one with `getByText('Edit MDX Content')`.
 *
 * The label became "Can edit MDX documents". From that day the spec waited
 * thirty seconds for text that no longer existed, failed, and the assertion it
 * was actually there to make never ran once — in CI, on every run, while the
 * failure read as a broken test rather than as a guard that had stopped
 * guarding.
 *
 * This test holds the id-shaped handle in place. It is deliberately about the
 * ATTRIBUTE and not the words: an assertion on the label would reintroduce
 * exactly what went wrong.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionMatrixTable } from '../PermissionMatrixTable';
import { Permission } from '@/lib/permissions-service/types';
import { PERMISSION_CATEGORIES, type PermissionDefinition } from '../permission-constants';

describe('the permission matrix', () => {
  it('gives every row a handle that survives a rewording', () => {
    const allPermissions: [string, PermissionDefinition[]][] =
      Object.entries(PERMISSION_CATEGORIES);

    render(
      <PermissionMatrixTable
        allPermissions={allPermissions}
        // No role columns: the rows are what is under test, and they render without any.
        roles={[]}
        cell={() => ({ checked: false, editable: false })}
        lockOf={() => null}
        onToggle={() => undefined}
      />,
    );

    // The one the phone spec reaches for.
    expect(screen.getByTestId(`permission-row-${Permission.EditMdx}`)).toBeInTheDocument();

    // And every other one, so a row cannot be added without a handle.
    const missing: string[] = [];
    for (const permissions of Object.values(PERMISSION_CATEGORIES)) {
      for (const permission of permissions) {
        if (!screen.queryByTestId(`permission-row-${permission.id}`)) missing.push(permission.id);
      }
    }
    expect(missing, 'every permission the matrix renders needs an id-shaped handle').toEqual([]);
  });
});
