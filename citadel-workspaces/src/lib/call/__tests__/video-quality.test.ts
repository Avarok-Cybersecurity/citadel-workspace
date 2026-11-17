/**
 * The quality ceiling a person chooses.
 *
 * A call that stutters is worse than one that looks soft, and only the person
 * on it knows which they are living with. These cover the two things that make
 * the setting real rather than decorative: that each level actually costs less
 * than the one above it, and that choosing one stops the app moving off it.
 */
import { describe, it, expect } from 'vitest';
import { parseVideoQuality, type VideoQuality } from '../video-quality';
import { allowsAdaptation, cameraProfileFor, screenProfileFor } from '../video-quality-profiles';
import { VIDEO_QUALITY_OPTIONS } from '../video-quality-options';

const LEVELS: readonly VideoQuality[] = ['high', 'balanced', 'saver'];

describe('camera quality', () => {
  it('costs strictly less at each step down', () => {
    // A "lower" setting that does not lower anything is a control that lies.
    const bitrates: number[] = LEVELS.map((level) => cameraProfileFor(level).bitrate);
    expect(bitrates[0]).toBeGreaterThan(bitrates[1]);
    expect(bitrates[1]).toBeGreaterThan(bitrates[2]);
  });

  it('gives up pixels and frames together, not one at a time', () => {
    // A 360p stream at 30fps costs about what 480p at 24 does and looks worse;
    // the levels move both so each step is a real saving.
    const high: ReturnType<typeof cameraProfileFor> = cameraProfileFor('high');
    const saver: ReturnType<typeof cameraProfileFor> = cameraProfileFor('saver');
    expect(saver.width).toBeLessThan(high.width);
    expect(saver.framerate).toBeLessThan(high.framerate);
  });

  it('treats automatic as the full profile', () => {
    expect(cameraProfileFor('auto')).toEqual(cameraProfileFor('high'));
  });
});

describe('screen quality', () => {
  it('surrenders frame rate before resolution', () => {
    // Unreadable text is not a smaller version of readable text, it is nothing.
    // So the first step down keeps every pixel and halves the rate.
    const full: ReturnType<typeof screenProfileFor> = screenProfileFor('auto');
    const balanced: ReturnType<typeof screenProfileFor> = screenProfileFor('balanced');
    expect(balanced.width).toBe(full.width);
    expect(balanced.framerate).toBeLessThan(full.framerate);
  });

  it('still costs less at every step', () => {
    const bitrates: number[] = LEVELS.map((level) => screenProfileFor(level).bitrate);
    expect(bitrates[0]).toBeGreaterThan(bitrates[1]);
    expect(bitrates[1]).toBeGreaterThan(bitrates[2]);
  });
});

describe('adaptation', () => {
  it('is allowed only when the person asked for automatic', () => {
    // Somebody who picked "High detail" picked it. An app that quietly steps
    // off a chosen level makes the setting a suggestion, which is the worst
    // kind of control because it looks like it did something.
    expect(allowsAdaptation('auto')).toBe(true);
    for (const level of LEVELS) expect(allowsAdaptation(level)).toBe(false);
  });
});

describe('the stored preference', () => {
  it('falls back to automatic for anything it does not recognise', () => {
    expect(parseVideoQuality(null)).toBe('auto');
    expect(parseVideoQuality('')).toBe('auto');
    expect(parseVideoQuality('ultra')).toBe('auto');
  });

  it('round-trips every offered option', () => {
    // The list the UI renders and the values the parser accepts are the same
    // set; an option that could be picked and not restored would silently
    // revert on the next call.
    for (const option of VIDEO_QUALITY_OPTIONS) {
      expect(parseVideoQuality(option.id)).toBe(option.id);
    }
  });

  it('offers automatic first, as the recommendation', () => {
    expect(VIDEO_QUALITY_OPTIONS[0].id).toBe('auto');
  });
});
