/**
 * Edit and Reply hand focus to the composer, not back to the menu button.
 *
 * Measured live (focus trace in an office channel): after choosing Edit, the message was
 * loaded into the composer and focus returned to the actions button when the menu closed,
 * so the next keystroke went nowhere. A focus call made from outside lost to the menu's
 * own focus return; the menu now hands focus over as it closes.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextBubble } from '@/components/p2p/bubbles/TextBubble';

async function choose(item: string): Promise<{ focusComposer: ReturnType<typeof vi.fn> }> {
  const focusComposer: ReturnType<typeof vi.fn> = vi.fn();
  const message: never = { id: 'm1', content: 'hello', timestamp: 1, status: 'sent' } as never;
  render(<TextBubble message={message} isOwn quoted={null} showSenderName senderName="lara" onEdit={(): void => {}} onDelete={(): void => {}}
    onReply={(): void => {}} focusComposer={focusComposer} />);
  await userEvent.click(screen.getByRole('button', { name: /message actions/i }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
  return { focusComposer };
}

describe('choosing from a channel message menu', () => {
  it.each(['Edit', 'Reply'])('%s gives the composer focus as the menu closes', async (item: string) => {
    const { focusComposer } = await choose(item);
    await waitFor((): void => { expect(focusComposer).toHaveBeenCalledTimes(1); });
    expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Message actions');
  });

  it('Delete does not: its confirmation takes focus', async () => {
    const { focusComposer } = await choose('Delete');
    await new Promise((r) => setTimeout(r, 50));
    expect(focusComposer).not.toHaveBeenCalled();
  });
});

describe('a P2P bubble menu', () => {
  // The same flaw in the P2P chat's own menus, measured live; one hook serves both.
  it.each(['Edit', 'Reply'])('%s gives the composer focus as the menu closes', async (item: string) => {
    const focusComposer: ReturnType<typeof vi.fn> = vi.fn();
    const message: never = { id: 'p1', content: 'hi', senderCid: 1n, timestamp: 1, status: 'delivered' } as never;
    render(<TextBubble message={message} isOwn quoted={null} onEdit={(): void => {}} onReply={(): void => {}} focusComposer={focusComposer} />);
    await userEvent.click(screen.getByRole('button', { name: /message actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: item }));
    await waitFor((): void => { expect(focusComposer).toHaveBeenCalledTimes(1); });
  });
});
