/**
 * An invite link (`/?join=1&server=<host>`) opens the join wizard with the
 * server filled in. Its parameters stay while the wizard is open, so a reload
 * reopens it, and are cleared once it closes.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useJoinLink } from '../use-join-link';

function at(url: string): (p: { children: ReactNode }) => JSX.Element {
  return ({ children }: { children: ReactNode }): JSX.Element => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
}

interface Run { open: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn>; search: () => string; setWizardOpen: (open: boolean) => void }

function run(url: string): Run {
  const open: ReturnType<typeof vi.fn> = vi.fn();
  const fill: ReturnType<typeof vi.fn> = vi.fn();
  const { result, rerender } = renderHook(({ wizardOpen }: { wizardOpen: boolean }) => {
    useJoinLink(open, fill, wizardOpen);
    return useLocation().search;
  }, { wrapper: at(url), initialProps: { wizardOpen: false } });
  return { open, fill, search: (): string => result.current, setWizardOpen: (o: boolean): void => { rerender({ wizardOpen: o }); } };
}

describe('a join link', () => {
  it('opens the wizard with the named server filled in', () => {
    const { open, fill } = run('/?join=1&server=work.example.net%3A12349');
    expect(open).toHaveBeenCalledTimes(1);
    expect(fill).toHaveBeenCalledWith('work.example.net:12349');
  });

  it('keeps its parameters while the wizard is open, so a reload reopens it', () => {
    const { search, setWizardOpen } = run('/?join=1&server=work.example.net%3A12349');
    setWizardOpen(true);
    expect(search()).toBe('?join=1&server=work.example.net%3A12349');
    // What the page reloads to: the URL it is on now, as a fresh mount.
    const reloaded: Run = run(`/${search()}`);
    expect(reloaded.fill).toHaveBeenCalledWith('work.example.net:12349');
  });

  it('clears them once the wizard closes', async () => {
    const { search, setWizardOpen } = run('/?join=1&server=work.example.net%3A12349');
    setWizardOpen(true);
    setWizardOpen(false);
    await waitFor(() => expect(search()).toBe(''));
  });

  it('opens the wizard empty when it names no server', () => {
    const { open, fill } = run('/?join=1');
    expect(open).toHaveBeenCalledTimes(1);
    expect(fill).not.toHaveBeenCalled();
  });

  it('does nothing without join=1', () => {
    const { open, fill, search } = run('/?server=work.example.net');
    expect(open).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
    expect(search()).toBe('?server=work.example.net');
  });
});
