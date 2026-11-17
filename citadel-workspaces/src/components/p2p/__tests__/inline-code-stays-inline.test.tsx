/**
 * Inline `code` in a Markdown message is inline, in your bubble and theirs.
 *
 * Seen on the live bench: in the sender's own bubble, "run `npm ci` now" showed
 * the backticks and put `npm ci` on a line of its own.
 *
 * Two causes, both in MarkdownBubble. react-markdown 9 stopped passing the
 * `inline` prop the `code` renderer branched on, so every code span took the
 * block branch -- `display: block`, padding, a bottom margin. And the prose
 * typography plugin paints a literal backtick before and after every `code`,
 * which the bubble never switched off.
 *
 * jsdom applies no stylesheet, so this pins the structure the styles key on:
 * an inline span is not given the block treatment, is not inside a <pre>, and
 * the prose container opts out of the pseudo-element backticks. It also pins
 * that the sender's bubble and the recipient's render the SAME markup; only the
 * colour inversion may differ. The rendered geometry was checked against the
 * built CSS in a browser -- see the PR.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarkdownBubble } from '../bubbles/MarkdownBubble';
import type { P2PMessage } from '@/lib/p2p/p2p-types';

const CONTENT: string = 'run `npm ci` now\n\n```\nnpm run build\n```';

function message(): P2PMessage {
  return {
    id: 'm1', content: CONTENT, senderCid: 2n, recipientCid: 1n, timestamp: 1_700_000_000_000,
    index: 0, status: 'delivered', message_type: 'markdown',
  } as unknown as P2PMessage;
}

function renderMarkdown(isOwn: boolean): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <MarkdownBubble message={message()} isOwn={isOwn} quoted={null} />
    </MemoryRouter>,
  );
  const prose: Element | null = container.querySelector('.prose');
  if (!(prose instanceof HTMLElement)) throw new Error('no markdown container rendered');
  return prose;
}

function codes(prose: HTMLElement): { inline: HTMLElement; block: HTMLElement } {
  const all: HTMLElement[] = Array.from(prose.querySelectorAll('code'));
  const inline: HTMLElement | undefined = all.find((c) => c.textContent === 'npm ci');
  const block: HTMLElement | undefined = all.find((c) => c.textContent?.includes('npm run build'));
  if (!inline || !block) throw new Error('expected one inline and one fenced code element');
  return { inline, block };
}

describe.each([['your own bubble', true], ["a peer's bubble", false]])('inline code in %s', (_label, isOwn) => {
  it('is not given the block treatment', () => {
    const { inline } = codes(renderMarkdown(isOwn));
    expect(inline.closest('pre')).toBeNull();
    expect(inline.className.split(/\s+/)).not.toContain('block');
  });

  it('keeps a fenced block a block', () => {
    // Positive control: the fix must not flatten real code blocks.
    const { block } = codes(renderMarkdown(isOwn));
    expect(block.closest('pre')).not.toBeNull();
  });

  it('switches off the typography plugin’s literal backticks', () => {
    const prose: HTMLElement = renderMarkdown(isOwn);
    expect(prose.className).toContain('prose-code:before:content-none');
    expect(prose.className).toContain('prose-code:after:content-none');
  });
});

describe('the two bubbles', () => {
  it('render the same markup for the same message', () => {
    const own: string = renderMarkdown(true).innerHTML;
    document.body.innerHTML = '';
    const theirs: string = renderMarkdown(false).innerHTML;
    expect(own).toBe(theirs);
  });
});
