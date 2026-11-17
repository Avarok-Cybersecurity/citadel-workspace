/**
 * What the title bar shows over time, Google Docs' way: a save is not news until it takes long,
 * "Saving…" never flashes, and anything that needs the person shows at once. Pure: every step
 * is given its time, so nothing here waits or races.
 */
import { describe, expect, it } from 'vitest';
import type { SaveStatus } from '../save-status';
import { INITIAL_SAVE_INDICATOR, visibleSaveState, type SaveIndicatorMemory, type SaveIndicatorTiming, type VisibleSave } from '../visible-save-state';

// The rule's shape, not the shipped numbers (save-indicator-timing.ts holds those).
const TIMING: SaveIndicatorTiming = { showSavingAfterMs: 1500, minSavingShownMs: 1000 };

/** Feeds `steps` ([ms, status]) in order and returns what was shown at each. */
function run(steps: readonly (readonly [number, SaveStatus])[], from: SaveIndicatorMemory = INITIAL_SAVE_INDICATOR): VisibleSave[] {
  let memory: SaveIndicatorMemory = from;
  return steps.map(([now, status]: readonly [number, SaveStatus]): VisibleSave => {
    const step: VisibleSave = visibleSaveState(status, memory, now, TIMING);
    memory = step.memory;
    return step;
  });
}

const shown = (steps: readonly (readonly [number, SaveStatus])[], from?: SaveIndicatorMemory): SaveStatus[] => run(steps, from).map((s: VisibleSave): SaveStatus => s.shown);

describe('the visible save state', () => {
  it('stays "saved" through a run of quick saves, one per keystroke', () => {
    const typing: [number, SaveStatus][] = [];
    for (let t: number = 0; t < 10_000; t += 200) typing.push([t, 'saving'], [t + 120, 'saved']);
    expect(new Set(shown(typing))).toEqual(new Set(['saved']));
  });

  it('asks to be woken when a pending save would become news, and shows "Saving…" then', () => {
    const [first, later] = run([[0, 'saving'], [1500, 'saving']]);
    expect(first).toMatchObject({ shown: 'saved', wakeAt: 1500 });
    expect(later).toMatchObject({ shown: 'saving', wakeAt: null });
  });

  it('dates a long save from its start, not from the latest keystroke', () => {
    expect(shown([[0, 'saving'], [700, 'saving'], [1400, 'saving'], [1600, 'saving']])).toEqual(['saved', 'saved', 'saved', 'saving']);
  });

  it('keeps "Saving…" for its minimum once shown, so it never flashes, then says saved', () => {
    const steps: VisibleSave[] = run([[0, 'saving'], [1500, 'saving'], [1600, 'saved'], [2500, 'saved']]);
    expect(steps.map((s: VisibleSave): SaveStatus => s.shown)).toEqual(['saved', 'saving', 'saving', 'saved']);
    expect(steps[2]?.wakeAt).toBe(2500);
  });

  it('shows what needs the person at once, cutting a shown "Saving…" short', () => {
    expect(shown([[0, 'offline']])).toEqual(['offline']);
    expect(shown([[0, 'saving'], [1500, 'saving'], [1600, 'refused']])).toEqual(['saved', 'saving', 'refused']);
    expect(shown([[0, 'unsavedOnDevice'], [10, 'locked']])).toEqual(['unsavedOnDevice', 'locked']);
  });

  it('after a problem, shows progress towards fixing it at once', () => {
    expect(shown([[0, 'offline'], [5, 'saving'], [100, 'saved'], [1005, 'saved']])).toEqual(['offline', 'saving', 'saving', 'saved']);
  });

  it('with AutoSave off, keeps "Saved to this device" through each keystroke\'s device write', () => {
    expect(shown([[0, 'savedToDevice'], [10, 'saving'], [15, 'savedToDevice'], [300, 'saving'], [304, 'savedToDevice']])).toEqual(
      ['savedToDevice', 'savedToDevice', 'savedToDevice', 'savedToDevice', 'savedToDevice'],
    );
  });

  it('needs no wake-up when nothing is pending', () => {
    expect(run([[0, 'saved']])[0]?.wakeAt).toBeNull();
    expect(run([[0, 'offline']])[0]?.wakeAt).toBeNull();
  });
});
