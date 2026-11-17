/**
 * The New document dialog: no app is preselected, unavailable apps cannot be chosen, a parent
 * that may hold nothing says why, and what is submitted is exactly what was chosen.
 *
 * No mocks: `onCreate` is the dialog's only output and is a plain recorder here.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewDocumentDialog, type NewDocumentInput } from '../NewDocumentDialog';
import type { DocumentPlacement } from '../document-placement';

function renderDialog(placement: DocumentPlacement, onCreate: (input: NewDocumentInput) => Promise<void> = vi.fn(async (): Promise<void> => {})): void {
  render(<NewDocumentDialog parentName="Alexanderplatz 1" placement={placement} onCreate={onCreate} onClose={vi.fn()} />);
}

const ONE: DocumentPlacement = { kind: 'one', type: 'Floor' };

describe('the app picker', () => {
  it('chooses no app until the person does, so Create stays disabled', async () => {
    renderDialog(ONE);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    await userEvent.type(screen.getByTestId('new-document-name'), 'Plan');
    expect(screen.getByTestId('new-document-create')).toBeDisabled();
  });

  it('lists PDF and LaTeX as coming soon, and they cannot be chosen', async () => {
    renderDialog(ONE);
    for (const name of ['Citadel PDF', 'Citadel LaTeX']) {
      const radio: HTMLElement = screen.getByRole('radio', { name: new RegExp(name) });
      expect(radio).toBeDisabled();
    }
    expect(screen.getByRole('radio', { name: /Citadel Docs/ })).toBeEnabled();
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
    await userEvent.click(screen.getByTestId('new-document-app-pdf'));
    expect(screen.getByRole('radio', { name: /Citadel PDF/ })).not.toBeChecked();
  });

  it('submits Docs at the level the schema permits', async () => {
    const onCreate: (input: NewDocumentInput) => Promise<void> = vi.fn(async (): Promise<void> => {});
    renderDialog(ONE, onCreate);
    await userEvent.click(screen.getByTestId('new-document-app-docs'));
    await userEvent.type(screen.getByTestId('new-document-name'), 'Plan');
    await userEvent.click(screen.getByTestId('new-document-create'));
    expect(onCreate).toHaveBeenCalledWith({ app: 'docs', childType: 'Floor', name: 'Plan' });
  });

  it('asks for the level when several are permitted, and submits the one chosen', async () => {
    const onCreate: (input: NewDocumentInput) => Promise<void> = vi.fn(async (): Promise<void> => {});
    renderDialog({ kind: 'pick', types: ['Floor', 'Desk'] }, onCreate);
    await userEvent.click(screen.getByTestId('new-document-app-docs'));
    await userEvent.type(screen.getByTestId('new-document-name'), 'Plan');
    expect(screen.getByTestId('new-document-create')).toBeDisabled();
    await userEvent.click(screen.getByTestId('new-document-level-Desk'));
    await userEvent.click(screen.getByTestId('new-document-create'));
    expect(onCreate).toHaveBeenCalledWith({ app: 'docs', childType: 'Desk', name: 'Plan' });
  });

  it('says why when nothing may be added here, and offers no way to create', () => {
    renderDialog({ kind: 'blocked', reason: 'Nothing can be added inside Floor 3' });
    expect(screen.getByTestId('new-document-blocked')).toHaveTextContent('Nothing can be added inside Floor 3');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('new-document-create')).toBeDisabled();
  });

  it('shows the server\'s refusal and keeps the dialog open', async () => {
    renderDialog(ONE, async (): Promise<void> => { throw new Error('Permission denied: EditTreeStructure required'); });
    await userEvent.click(screen.getByTestId('new-document-app-docs'));
    await userEvent.type(screen.getByTestId('new-document-name'), 'Plan');
    await userEvent.click(screen.getByTestId('new-document-create'));
    expect(await screen.findByRole('alert')).toHaveTextContent('EditTreeStructure');
    expect(screen.getByTestId('new-document-dialog')).toBeInTheDocument();
  });

  it('moves between apps with the arrow keys', async () => {
    renderDialog(ONE);
    await userEvent.click(screen.getByTestId('new-document-app-docs'));
    expect(screen.getByRole('radio', { name: /Citadel Docs/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    // The only other apps are unavailable, so focus stays where a choice can be made.
    expect(screen.getByRole('radio', { name: /Citadel Docs/ })).toHaveFocus();
  });
});
