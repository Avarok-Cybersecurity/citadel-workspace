/**
 * Each toolbar button inserts its markup once, and leaves the caret in the editor.
 *
 * Measured live (admin-lab, office page): with nothing selected, Bullet List inserted
 * "- - ", Link inserted "[Link text](url)" twice -- formatText's suffix defaulted to the
 * prefix, which is right for **bold** and wrong for anything that only prefixes -- and
 * Heading left focus on its button, so the next keystrokes went nowhere.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { MDXEditor } from '../MDXEditor';

function Harness({ initial, seen }: { initial: string; seen: string[] }): JSX.Element {
  const [value, setValue] = useState<string>(initial);
  return <MDXEditor value={value} onChange={(v: string): void => { seen.push(v); setValue(v); }} />;
}

function press(label: string, initial: string, caret: number): string[] {
  const seen: string[] = [];
  render(<Harness initial={initial} seen={seen} />);
  const area: HTMLTextAreaElement = screen.getByRole('textbox') as HTMLTextAreaElement;
  area.focus();
  area.setSelectionRange(caret, caret);
  fireEvent.click(screen.getByRole('button', { name: label }));
  return seen;
}

describe('the MDX toolbar with nothing selected', () => {
  it.each([
    ['Bullet List', 'x', 1, 'x- '],
    ['Numbered List', 'x', 1, 'x1. '],
    ['Blockquote', 'x', 1, 'x> '],
    ['Link', 'x', 1, 'x[Link text](url)'],
    ['Bold', 'x', 1, 'x****'],
  ])('%s inserts its markup once', (label: string, initial: string, caret: number, expected: string) => {
    expect(press(label, initial, caret).at(-1)).toBe(expected);
  });

  it('Heading 2 prefixes the line and returns focus to the editor', async () => {
    // A real click, which moves focus to the button as a browser does.
    const seen: string[] = [];
    render(<Harness initial="title" seen={seen} />);
    const area: HTMLTextAreaElement = screen.getByRole('textbox') as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(5, 5);
    await userEvent.click(screen.getByRole('button', { name: 'Heading 2' }));
    expect(seen.at(-1)).toBe('## title');
    await waitFor((): void => { expect(document.activeElement?.tagName).toBe('TEXTAREA'); });
  });
});
