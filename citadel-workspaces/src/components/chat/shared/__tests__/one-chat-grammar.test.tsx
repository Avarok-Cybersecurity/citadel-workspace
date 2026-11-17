/**
 * Two chat surfaces, one product.
 *
 * Group chat and P2P chat had drifted into visibly different designs for the
 * same thing: group showed date separators and P2P showed none, and the two
 * used different greys for a received bubble — 17% vs 22% lightness in dark
 * mode. Anyone who used a room and a DM in one session saw two products.
 *
 * These pin the parts that are now shared, because "looks the same" is exactly
 * the property that decays without something asserting it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { DateSeparator } from '../DateSeparator';
import { groupMessagesByDate } from '../formatters';

const SRC: string = join(process.cwd(), 'src');

describe('the date separator', () => {
  it('names the date to a screen reader without reading the rules around it', () => {
    render(<DateSeparator date="Tuesday" />);

    const separator: HTMLElement = screen.getByRole('separator', { name: 'Tuesday' });
    expect(separator).toHaveTextContent('Tuesday');
  });
});

describe('every chat surface', () => {
  // There were two, a group view and a direct one, each with its own separator and its own
  // received-bubble colour (`bg-muted` against `bg-surface`), and they drifted. There is one pane
  // now, so the grammar cannot be copied: each conversation renders it.
  it('is the one pane, whose list renders the shared separator', () => {
    for (const file of ['components/p2p/P2PChat.tsx', 'components/chat/PeerGroupChat.tsx', 'components/office/NodeChat.tsx']) {
      expect(readFileSync(join(SRC, file), 'utf-8'), `${file} should render the chat pane`).toContain('<ChatPane');
    }
    expect(readFileSync(join(SRC, 'components/chat/pane/MessageList.tsx'), 'utf-8')).toContain('<DateSeparator');
  });

  it('uses the received-bubble surface with the documented contrast reason', () => {
    const p2p: string = readFileSync(join(SRC, 'components/p2p/bubbles/types.ts'), 'utf-8');
    expect(p2p).toContain('bg-surface text-foreground');
  });

  it('group messages by date with one shared rule', () => {
    const sameDay: Record<string, { timestamp: number; }[]> = groupMessagesByDate([
      { timestamp: 1700000000000 },
      { timestamp: 1700000001000 },
    ]);
    expect(Object.keys(sameDay)).toHaveLength(1);

    const twoDays: Record<string, { timestamp: number; }[]> = groupMessagesByDate([
      { timestamp: 1700000000000 },
      { timestamp: 1700000000000 + 86_400_000 * 2 },
    ]);
    expect(Object.keys(twoDays)).toHaveLength(2);
  });
});
