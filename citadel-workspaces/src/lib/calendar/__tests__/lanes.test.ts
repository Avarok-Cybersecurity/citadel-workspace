import { describe, expect, it } from 'vitest';
import { layoutLanes } from '../lanes';
import type { Laned } from '@/lib/calendar/lanes';

const t = (fromMinute: number, toMinute: number): { fromMinute: number; toMinute: number } => ({ fromMinute, toMinute });

describe('lanes in a day column', () => {
  it('gives chips that do not overlap the whole width', () => {
    expect(layoutLanes([t(540, 600), t(600, 660)]).map((l) => [l.lane, l.lanes])).toEqual([[0, 1], [0, 1]]);
  });

  it('shares the width within an overlapping cluster and reuses a lane once it frees', () => {
    const laid: Laned<{ fromMinute: number; toMinute: number; }>[] = layoutLanes([t(540, 660), t(570, 600), t(600, 630), t(700, 720)]);
    expect(laid.map((l) => [l.item.fromMinute, l.lane, l.lanes])).toEqual([[540, 0, 2], [570, 1, 2], [600, 1, 2], [700, 0, 1]]);
  });

  it('gives a zero-length event a lane of its own minimum height', () => {
    expect(layoutLanes([t(540, 540), t(545, 600)]).map((l) => l.lanes)).toEqual([2, 2]);
  });
});
