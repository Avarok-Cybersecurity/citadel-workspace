/**
 * The admin "Chat Features" preview lists only what members can use.
 *
 * Reactions were types only, so the row said "(planned)". They now ship in P2P
 * chat and peer groups, so the row says available -- and this pins that the
 * claim is backed: the bubble every chat renders actually mounts the picker,
 * and every chat renders it. If the picker is removed, the row has to go back
 * to planned.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const source: string = read('src/components/admin/tabs/ChatSettingsTab.tsx');

describe('chat features preview', () => {
  it('marks reactions as available', () => {
    expect(source).not.toContain('Message reactions (planned)');
    expect(source).toMatch(/bg-success" \/>\s*Message reactions\s*</);
  });

  it('is backed by a picker in the bubble every chat renders', () => {
    const bubble: string = read('src/components/p2p/bubbles/TextBubble.tsx');
    expect(bubble).toContain('<ReactionMenuItems');
    expect(bubble).toContain('<ReactionChips');
    for (const chat of ['src/components/p2p/P2PChat.tsx', 'src/components/chat/PeerGroupChat.tsx', 'src/components/office/NodeChat.tsx']) {
      expect(read(chat), `${chat} renders the one chat pane`).toContain('<ChatPane');
    }
  });
});
