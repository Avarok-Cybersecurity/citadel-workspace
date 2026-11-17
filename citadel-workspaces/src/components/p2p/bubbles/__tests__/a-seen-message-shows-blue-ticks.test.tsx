/**
 * "Seen" is two BLUE ticks, readable on your own bubble in both themes.
 *
 * The read tick was text-primary-accent -- purple, on a purple bubble -- so a
 * seen message looked like a delivered one with a tint. The group footer's
 * comment even said "Blue for all read" over the same purple class.
 *
 * The contrast is computed from the shipped tokens rather than asserted from a
 * class name: a graphic that carries state needs 3:1 against what it sits on,
 * and the tick only ever sits on your own bubble (bg-primary).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BubbleFooter } from '../BubbleFooter';
import type { P2PMessage } from '@/lib/p2p';

const CSS: string = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');

function token(block: ':root' | '.dark', name: string): [number, number, number] {
  const start: number = CSS.indexOf(`  ${block} {`);
  const body: string = CSS.slice(start, CSS.indexOf('\n  }', start));
  const m: RegExpMatchArray | null = body.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`--${name} not defined in ${block}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance([h, s, l]: [number, number, number]): number {
  const a: number = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number): number => {
    const k: number = (n + h / 30) % 12;
    const c: number = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(0) + 0.7152 * f(8) + 0.0722 * f(4);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the seen tick', () => {
  it('is drawn in the read-receipt colour', () => {
    render(<BubbleFooter message={{ id: 'm', content: 'hi', timestamp: 1, status: 'read' } as P2PMessage} isOwn={true} />);
    expect(screen.getByTestId('message-status-read').getAttribute('class')).toMatch(/\btext-read-receipt\b/);
  });

  for (const block of [':root', '.dark'] as const) {
    it(`is blue and clears 3:1 on your own bubble (${block})`, () => {
      const tick: [number, number, number] = token(block, 'read-receipt');
      expect(tick[0], 'hue should be blue').toBeGreaterThanOrEqual(190);
      expect(tick[0], 'hue should be blue').toBeLessThanOrEqual(220);
      expect(contrast(tick, token(block, 'primary'))).toBeGreaterThanOrEqual(3);
    });
  }
});
