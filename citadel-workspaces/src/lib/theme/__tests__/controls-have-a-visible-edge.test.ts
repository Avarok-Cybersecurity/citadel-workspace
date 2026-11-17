/**
 * Every text field has a visible edge, in every theme and both modes.
 *
 * Live (owner, 2026-09-27): in light mode the chat composer had no visible border; the owner
 * asked for it to follow the colour scheme (Avarok purple). The resting border of every Input
 * and Textarea was `--input`, `240 20% 97%` -- about 1.08:1 on white -- and the composers
 * overrode it with `border-surface/50`. Controls now draw their edge with `--control-border`,
 * held to WCAG 1.4.11's 3:1 non-text minimum against every surface a field sits on.
 *
 * No mocks: the presets, the builder, the contrast maths and the validator are production code.
 */
import { describe, it, expect } from 'vitest';
import { PRESET_THEMES, defaultTheme } from '../presets';
import { contrastRatio } from '../hsl';
import { validateTheme } from '../theme-serialization';
import type { ThemePalette } from '../theme-types';

const NON_TEXT_MIN: number = 3;

describe('the control border', () => {
  for (const theme of PRESET_THEMES) {
    for (const mode of ['light', 'dark'] as const) {
      it(`clears 3:1 on background, card and surface in ${theme.name} (${mode})`, () => {
        const p: ThemePalette = theme[mode];
        for (const surface of ['background', 'card', 'surface'] as const) {
          expect(contrastRatio(p.controlBorder, p[surface]), `${surface}`).toBeGreaterThanOrEqual(NON_TEXT_MIN);
        }
      });
    }
  }

  it('is a purple in the Avarok theme, following the scheme', () => {
    const light: ThemePalette = defaultTheme().light;
    expect(Math.abs(light.controlBorder.h - light.primary.h)).toBeLessThanOrEqual(10);
  });

  it('is derived for a theme saved before the token existed, instead of rejecting the theme', () => {
    const saved: Record<string, unknown> = JSON.parse(JSON.stringify(defaultTheme())) as Record<string, unknown>;
    for (const mode of ['light', 'dark'] as const) delete (saved[mode] as Record<string, unknown>).controlBorder;
    const restored: ReturnType<typeof validateTheme> = validateTheme(saved);
    expect(restored, 'a pre-token saved theme fell back to the default').not.toBeNull();
    expect(contrastRatio(restored!.light.controlBorder, restored!.light.background)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });
});
