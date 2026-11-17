/**
 * A confirmation keeps its title while it closes.
 *
 * Answering cleared the request and closed the dialog in one update, so the
 * dialog spent its exit animation empty -- two buttons in a blank box, caught
 * in a CI screenshot of a folder delete. Every text the title shows between
 * opening and unmounting is recorded, and none may be empty.
 *
 * No mocks: the provider, the dialog and Radix are the production components.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ConfirmDialogProvider, useConfirm } from '../confirm-dialog';

function Asker(): JSX.Element {
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  return <button onClick={() => { void confirm({ title: 'Delete "test-folder"?' }); }}>ask</button>;
}

async function titlesSeenWhileAnswering(answer: 'confirm-dialog-confirm' | 'Cancel'): Promise<string[]> {
  render(<ConfirmDialogProvider><Asker /></ConfirmDialogProvider>);
  fireEvent.click(screen.getByText('ask'));
  const heading: HTMLElement = await screen.findByRole('heading');
  const seen: string[] = [heading.textContent ?? ''];
  const observer: MutationObserver = new MutationObserver(() => { seen.push(heading.textContent ?? ''); });
  observer.observe(heading, { childList: true, characterData: true, subtree: true });
  await act(async () => {
    fireEvent.click(answer === 'Cancel' ? screen.getByText('Cancel') : screen.getByTestId(answer));
  });
  await waitFor(() => { expect(screen.queryByRole('heading')).toBeNull(); });
  observer.disconnect();
  return seen;
}

describe('a confirmation that is answered', () => {
  it('never shows an empty title on its way out after Delete', async () => {
    const seen: string[] = await titlesSeenWhileAnswering('confirm-dialog-confirm');
    expect(seen).not.toContain('');
    expect(seen[0]).toBe('Delete "test-folder"?');
  });

  it('never shows an empty title on its way out after Cancel', async () => {
    const seen: string[] = await titlesSeenWhileAnswering('Cancel');
    expect(seen).not.toContain('');
  });
});
