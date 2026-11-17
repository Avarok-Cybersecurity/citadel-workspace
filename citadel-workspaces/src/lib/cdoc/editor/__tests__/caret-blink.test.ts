/** The caret's blink as a state machine over a clock the test steps. */
import { describe, expect, it } from 'vitest';
import { CaretBlink } from '../caret-blink';
import { ManualRepeat } from '@/components/documents/__tests__/manual-clock';

function rig(): { blink: CaretBlink; clock: ManualRepeat; shown: boolean[] } {
  const clock: ManualRepeat = new ManualRepeat();
  const shown: boolean[] = [];
  return { blink: new CaretBlink(clock.repeat, 530, (v: boolean) => shown.push(v)), clock, shown };
}

describe('the caret blink', () => {
  it('shows the caret when focused, then hides and shows it every phase', () => {
    const { blink, clock, shown } = rig();
    blink.update({ focused: true, dragging: false, reducedMotion: false });
    expect(clock.running).toEqual([530]);
    clock.tick();
    clock.tick();
    expect(shown).toEqual([true, false, true]);
  });

  it('restarts visible on a caret move, with a fresh phase', () => {
    const { blink, clock, shown } = rig();
    blink.update({ focused: true, dragging: false, reducedMotion: false });
    clock.tick();
    blink.restart();
    expect(shown).toEqual([true, false, true]);
    expect(clock.running).toEqual([530]);
  });

  it('holds the caret steady while a drag selects, and for reduced motion', () => {
    for (const inputs of [{ dragging: true, reducedMotion: false }, { dragging: false, reducedMotion: true }]) {
      const { blink, clock, shown } = rig();
      blink.update({ focused: true, ...inputs });
      clock.tick();
      expect(clock.running).toEqual([]);
      expect(shown).toEqual([true]);
    }
  });

  it('hides the caret when the document loses focus, and stops the clock', () => {
    const { blink, clock, shown } = rig();
    blink.update({ focused: true, dragging: false, reducedMotion: false });
    blink.update({ focused: false, dragging: false, reducedMotion: false });
    expect(shown).toEqual([true, false]);
    expect(clock.running).toEqual([]);
  });

  it('refuses a phase that is not positive', () => {
    expect(() => new CaretBlink(new ManualRepeat().repeat, 0, () => undefined)).toThrow(/positive/);
  });
});
