import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { UserSearch } from '../UserSearch';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';

/**
 * Three fixes live in this component, and none had a fast guard.
 *
 * The results panel is position:absolute z-50 and covers whatever is beneath it —
 * on the directory page, the All/Online tabs. A mouse user was fine by accident
 * (mousedown closes it before the click lands); a keyboard user had no way to
 * dismiss it and no way to reach what it covered. It also had no combobox
 * semantics at all, so nothing announced the relationship between the input and
 * the list.
 *
 * State is injected through the real WorkspaceContext rather than by mocking the
 * module: the provider does live work this test has no use for, and passing a
 * value into the context that ships is the same wiring the app uses.
 */
const members: { 'user-1': { id: string; username: string; displayName: string; role: string; }; 'user-2': { id: string; username: string; displayName: string; role: string; }; } = {
  'user-1': { id: 'user-1', username: 'ada', displayName: 'Ada Lovelace', role: 'Member' },
  'user-2': { id: 'user-2', username: 'grace', displayName: 'Grace Hopper', role: 'Member' },
};

function renderSearch(): HTMLElement {
  render(
    <WorkspaceContext.Provider
      value={{ state: { members } as never }}
    >
      <UserSearch placeholder="Search users" />
    </WorkspaceContext.Provider>
  );
  return screen.getByPlaceholderText('Search users');
}

afterEach(cleanup);

describe('UserSearch', () => {
  it('describes itself as a combobox controlling a list', () => {
    const input: HTMLElement = renderSearch();

    // Without these the input and its results have no announced relationship,
    // however correct the visuals are.
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-controls');
  });

  it('reports the panel as expanded once it opens', async () => {
    const input: HTMLElement = renderSearch();

    fireEvent.focus(input);

    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('listbox', { name: 'User search results' })).toBeInTheDocument();
  });

  it('closes the panel on Escape', async () => {
    const input: HTMLElement = renderSearch();

    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Escape' });

    // The whole point: the panel covers the controls under it, so a keyboard
    // user who cannot dismiss it cannot reach them either.
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('makes each result an option that is itself focusable', async () => {
    const input: HTMLElement = renderSearch();

    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    const options: HTMLElement[] = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);

    // role="option" belongs on the focusable element, not on a wrapper around
    // one. It was on the <li> with a <button> inside — an option containing a
    // separate focusable control, which screen readers cannot resolve.
    for (const option of options) {
      expect(option.tagName).toBe('BUTTON');
    }
  });
});
