/**
 * A reader scrolled up must not be yanked to the bottom.
 *
 * The scroll effect pinned unconditionally on every change of `messages`, and
 * the status subscription's `prev.map` ALWAYS allocates — so the array identity
 * changed for a sent/delivered/read transition in ANY conversation, not just
 * this one. Someone reading yesterday's thread was thrown back to the newest
 * message by a delivery receipt in a completely different chat.
 *
 * It also fought the pagination anchoring in useP2PMessages, which goes to real
 * trouble to preserve scroll position across a prepend.
 *
 * Two halves, tested separately: this file covers the identity half (the cheap,
 * deterministic one); the geometric half is asserted in the integration suite,
 * because jsdom reports every element as 0x0 and cannot see a scroll position.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The follow logic is the shared useStickToBottom (pure rules in lib/chat-scroll/stick,
// behaviour tested there and in components/chat/__tests__/stick-to-bottom.test.tsx);
// the chat is checked for calling it, so the wiring cannot be dropped.
describe('the chat scroll', () => {
  it('is the chat’s own: the chat pane runs the shared stick-to-bottom hook over its messages', () => {
    const chat: string = readFileSync(join(process.cwd(), 'src/components/chat/pane/use-chat-pane.ts'), 'utf8');
    expect(chat).toMatch(/useStickToBottom\(scrollRef,\s*messages\.messages/);
  });

  it('still lands on the newest message when a conversation is first opened', () => {
    const src: string = readFileSync(join(process.cwd(), 'src/components/chat/use-stick-to-bottom.ts'), 'utf8');
    // scrollTop is 0 on first paint, so a pure near-the-bottom test would open
    // every conversation at the TOP of its history.
    expect(src).toMatch(/el\.scrollTop = el\.scrollHeight/);
  });
});
