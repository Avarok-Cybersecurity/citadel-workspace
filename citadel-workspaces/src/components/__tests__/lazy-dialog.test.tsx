/**
 * lazyDialog keeps a dialog's code off the landing page until it is opened.
 *
 * What it must not do: fetch before the first open (that would put the code
 * back on the critical path it exists to shorten), or unmount on close (the
 * close animation would be cut off). The loader here is a real dynamic-import
 * stand-in — a promise — not a mock of the helper.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { lazyDialog } from '../lazy-dialog';

interface Props { isOpen: boolean; label: string }

function makeDialog(): { Dialog: (props: Props) => JSX.Element | null; loads: () => number } {
  let loads: number = 0;
  const Dialog: (props: Props) => JSX.Element | null = lazyDialog(
    async (): Promise<React.ComponentType<Props>> => {
      loads += 1;
      return ({ isOpen, label }: Props): JSX.Element => <div data-testid="dialog">{label}:{isOpen ? 'open' : 'closed'}</div>;
    },
    (props: Props): boolean => props.isOpen,
  );
  return { Dialog, loads: (): number => loads };
}

describe('lazyDialog', () => {
  it('fetches nothing and renders nothing until first opened', () => {
    const { Dialog, loads } = makeDialog();
    render(<Dialog isOpen={false} label="a" />);
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(loads()).toBe(0);
  });

  it('renders the loaded dialog with its props once opened', async () => {
    const { Dialog, loads } = makeDialog();
    const { rerender } = render(<Dialog isOpen={false} label="a" />);
    rerender(<Dialog isOpen label="b" />);
    expect((await screen.findByTestId('dialog')).textContent).toBe('b:open');
    expect(loads()).toBe(1);
  });

  it('stays mounted after closing, so the close can animate', async () => {
    const { Dialog, loads } = makeDialog();
    const { rerender } = render(<Dialog isOpen label="a" />);
    await screen.findByTestId('dialog');
    rerender(<Dialog isOpen={false} label="a" />);
    expect(screen.getByTestId('dialog').textContent).toBe('a:closed');
    rerender(<Dialog isOpen label="a" />);
    expect(loads()).toBe(1);
  });
});
