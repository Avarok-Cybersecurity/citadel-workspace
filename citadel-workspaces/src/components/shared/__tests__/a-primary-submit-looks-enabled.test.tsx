/**
 * An entity modal's primary submit is a solid fill, so an enabled button reads as enabled.
 *
 * Live (owner, 2026-09-27): "Create Office" looked disabled. Every non-destructive entity-modal
 * submit wore `bg-primary-accent/20 text-primary-accent` -- the tint of the Admin badge and of
 * the selected sidebar row -- which on a light surface is pale lavender with purple text, the
 * look of a disabled control. The primary action now uses the Button's default variant
 * (`bg-primary text-primary-foreground`), as "Create Group" already did.
 *
 * No mocks: the modal and the Button are the production components.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntityManagementModal, type ModeConfig } from '../EntityManagementModal';

const MODES: Record<'create' | 'delete', ModeConfig> = {
  create: { title: 'Create New Office', description: 'Add a new office', submitLabel: 'Create Office', submittingLabel: 'Creating...' },
  delete: { title: 'Delete Office', description: 'Remove it', submitLabel: 'Delete', submittingLabel: 'Deleting...', submitVariant: 'destructive' },
};

function submitClasses(mode: 'create' | 'delete'): string[] {
  render(
    <EntityManagementModal
      isOpen
      onClose={(): void => {}}
      mode={mode}
      modes={MODES}
      fields={[{ id: 'name', label: 'Office Name', type: 'input', required: true }]}
      onSubmit={async (): Promise<void> => {}}
      entityName="office"
    />,
  );
  return screen.getByTestId('entity-modal-submit').className.split(/\s+/);
}

describe('an entity modal submit', () => {
  it('is a solid primary fill, not a translucent tint', () => {
    const classes: string[] = submitClasses('create');
    expect(classes).toContain('bg-primary');
    expect(classes).toContain('text-primary-foreground');
    expect(classes.some((c: string) => /^bg-primary-accent\//.test(c))).toBe(false);
  });

  it('keeps the destructive fill for a destructive action', () => {
    const classes: string[] = submitClasses('delete');
    expect(classes).toContain('bg-destructive');
  });
});
