/**
 * The theme foundation. The load-bearing assertion is the first one: Avarok
 * Purple must still be exactly what the app shipped, or turning theming on
 * silently restyles everything.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname: string = dirname(fileURLToPath(import.meta.url));
import { PRESET_THEMES, defaultTheme, findPreset, DEFAULT_THEME_ID } from '../presets';
import { AVAROK_LIGHT, AVAROK_DARK } from '../preset-avarok';
import { paletteToCssVars, cssVarName, applyTheme, clearTheme } from '../apply-theme';
import { buildPalette, deriveDarkPalette } from '../palette-builder';
import { contrastRatio, fromHex, toHex, fromCssValue, toCssValue } from '../hsl';
import { beginEdit, setToken, renameTheme, canRename, uniqueName, resetDarkToDerived } from '../theme-editing';
import type { ThemePalette, HslColor } from '../theme-types';
import type { WorkspaceTheme, WorkspaceIcon } from '@/lib/theme/theme-types';

describe('Avarok Purple, the default', () => {
  it('is the default theme', () => {
    expect(defaultTheme().id).toBe(DEFAULT_THEME_ID);
    expect(defaultTheme().name).toBe('Avarok Purple');
  });

  it('reproduces the shipped light tokens exactly', () => {
    const vars: Record<string, string> = paletteToCssVars(defaultTheme().light);

    // Spot-check the values index.css actually carries, including the ones with
    // documented contrast reasoning.
    expect(vars['--background']).toBe('0 0% 100%');
    expect(vars['--primary']).toBe('257 45% 45%');
    expect(vars['--muted-foreground']).toBe('235 12% 38%');
    expect(vars['--border']).toBe('240 15% 88%');
  });

  it('reproduces the shipped dark tokens exactly', () => {
    const vars: Record<string, string> = paletteToCssVars(defaultTheme().dark);

    expect(vars['--background']).toBe('235 18% 13%');
    expect(vars['--primary']).toBe('257 30% 50%');
    expect(vars['--primary-accent']).toBe('251 85% 75%');
    // 72%, not 54% — the value Lighthouse forced.
    expect(vars['--muted-foreground']).toBe('265 25% 72%');
  });

  it('is not regenerated from a seed', () => {
    // Guards the whole point of preset-avarok.ts: if someone replaces it with
    // buildPalette, these hand-tuned values drift and the app restyles.
    expect(defaultTheme().light).toEqual(AVAROK_LIGHT);
    expect(defaultTheme().dark).toEqual(AVAROK_DARK);
  });
});

describe('index.css and the default preset agree', () => {
  // The spot-checks above cover four variables. That is how a real mistake got
  // through: a scripted edit meant for the `.dark` block matched the word
  // ".dark" in a COMMENT above `:root` and rewrote the light one instead, so
  // index.css and the preset disagreed about --success-foreground while every
  // test stayed green — the AA suite reads the preset, and the browser reads
  // index.css. Only one of those is what users see.
  //
  // Comparing every variable the palette emits closes that gap for all tokens
  // at once, rather than adding a fifth spot-check after each incident.
  const css: string = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  /** Pull one selector's custom properties, by brace depth rather than by a
   *  substring search — which is the bug this test exists to prevent. */
  function blockVars(selector: string): Record<string, string> {
    const start: number = css.indexOf(selector + ' {');
    if (start === -1) throw new Error(`no ${selector} block in index.css`);
    let depth: number = 0;
    let end: number = start;
    for (let i: number = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const vars: Record<string, string> = {};
    for (const [, name, value] of css.slice(start, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name] = value.split('/*')[0].trim();
    }
    return vars;
  }

  it.each([
    ['light', ':root'] as const,
    ['dark', '.dark'] as const,
  ])('%s matches the %s block', (mode, selector) => {
    const emitted: Record<string, string> = paletteToCssVars(defaultTheme()[mode]);
    const declared: Record<string, string> = blockVars(selector);
    const drift: string[] = Object.entries(emitted)
      .filter(([name, value]) => declared[name] !== undefined && declared[name] !== value)
      .map(([name, value]) => `${name}: preset ${value} vs css ${declared[name]}`);
    expect(drift).toEqual([]);
  });

  it('declares every token the palette emits', () => {
    const emitted: string[] = Object.keys(paletteToCssVars(defaultTheme().light));
    const declared: Record<string, string> = blockVars(':root');
    // A token the palette emits but index.css never declares is one the app
    // falls back to nothing for until a workspace theme loads.
    expect(emitted.filter((name) => declared[name] === undefined)).toEqual([]);
  });
});

describe('presets', () => {
  it('includes the requested well-known themes', () => {
    const names: string[] = PRESET_THEMES.map((t) => t.name);
    expect(names).toContain('Avarok Purple');
    expect(names).toContain('Material Lighter');
    expect(names).toContain('Material Darker');
    expect(names).toContain('Nord');
    expect(names).toContain('Dracula');
  });

  it('marks every preset as a preset', () => {
    expect(PRESET_THEMES.every((t) => t.isPreset)).toBe(true);
  });

  it('has unique ids and names', () => {
    expect(new Set(PRESET_THEMES.map((t) => t.id)).size).toBe(PRESET_THEMES.length);
    expect(new Set(PRESET_THEMES.map((t) => t.name)).size).toBe(PRESET_THEMES.length);
  });

  it.each(PRESET_THEMES.flatMap((t) => [
    [`${t.name} light`, t.light] as const,
    [`${t.name} dark`, t.dark] as const,
  ]))('%s keeps body text readable on its background', (_label, palette: ThemePalette) => {
    // AA for body text. A preset that fails this is not a style choice, it is
    // unusable — and it is the failure a hand-authored palette makes most often.
    expect(contrastRatio(palette.background, palette.foreground)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PRESET_THEMES.flatMap((t) => [
    [`${t.name} light`, t.light] as const,
    [`${t.name} dark`, t.dark] as const,
  ]))('%s keeps muted text readable on cards', (_label, palette: ThemePalette) => {
    expect(contrastRatio(palette.card, palette.mutedForeground)).toBeGreaterThanOrEqual(4.5);
  });

  // Every fill that carries text, not a hand-picked few. Checking only
  // background, card and primary is what let dark `destructive` ship at 3.78:1 —
  // white on a red that every delete button in the app uses. axe found it in the
  // theme preview; this is where it should have been caught.
  const TEXT_ON_FILL: ReadonlyArray<readonly [keyof ThemePalette, keyof ThemePalette]> = [
    ['background', 'foreground'],
    ['card', 'cardForeground'],
    ['card', 'mutedForeground'],
    ['surface', 'foreground'],
    ['muted', 'mutedForeground'],
    ['primary', 'primaryForeground'],
    ['secondary', 'secondaryForeground'],
    ['accent', 'accentForeground'],
    ['destructive', 'destructiveForeground'],
    // success and warning were missing, and both failed: white on the default
    // dark success is 2.59:1 and on the light warning 3.60:1. Status colours are
    // the easiest pairs to leave unchecked, because they are read as decoration
    // until the moment they carry the sentence that matters.
    ['success', 'successForeground'],
    ['warning', 'warningForeground'],
  ];

  // primaryAccent is not a fill — it is the accent TEXT and icon colour — so no
  // fill guarantee ever covered it, and five light presets shipped it between
  // 3.5:1 and 4.5:1 against their own card. The colour migration routed every
  // brand-tinted label in the app through this token, which turned a narrow
  // defect into a wide one.
  const ACCENT_SURFACES: readonly ["background", "card", "surface"] = ['background', 'card', 'surface'] as const;

  it.each(
    PRESET_THEMES.flatMap((t) =>
      (['light', 'dark'] as const).flatMap((mode) =>
        ACCENT_SURFACES.map(
          (surface) => [`${t.name} ${mode}: primaryAccent on ${surface}`, t[mode], surface] as const,
        ),
      ),
    ),
  )('%s clears AA', (_label, palette: ThemePalette, surface: (typeof ACCENT_SURFACES)[number]) => {
    expect(contrastRatio(palette[surface], palette.primaryAccent)).toBeGreaterThanOrEqual(4.5);
  });

  // The same defect, one token along. `destructive` had only a FILL guarantee —
  // white destructiveForeground readable on it — while being the colour of every
  // inline error in the app. As text the shipped dark fill measured 3.72:1 on
  // --background and 3.38:1 on --card. The two roles cannot share a value: text
  // needs L >= ~61% in dark, white-on-fill needs L <= ~50%.
  it.each(
    PRESET_THEMES.flatMap((t) =>
      (['light', 'dark'] as const).flatMap((mode) =>
        ACCENT_SURFACES.map(
          (surface) =>
            [`${t.name} ${mode}: destructiveEmphasis on ${surface}`, t[mode], surface] as const,
        ),
      ),
    ),
  )('%s clears AA', (_label, palette: ThemePalette, surface: (typeof ACCENT_SURFACES)[number]) => {
    expect(contrastRatio(palette[surface], palette.destructiveEmphasis)).toBeGreaterThanOrEqual(4.5);
  });

  // And the fill role still has to hold, so a future change cannot "fix" the
  // text by lightening the surface and silently break every destructive button.
  it.each(
    PRESET_THEMES.flatMap((t) =>
      (['light', 'dark'] as const).map(
        (mode) => [`${t.name} ${mode}: destructiveForeground on destructive`, t[mode]] as const,
      ),
    ),
  )('%s clears AA', (_label, palette: ThemePalette) => {
    expect(contrastRatio(palette.destructive, palette.destructiveForeground)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(
    PRESET_THEMES.flatMap((t) =>
      (['light', 'dark'] as const).flatMap((mode) =>
        TEXT_ON_FILL.map(
          ([fill, text]) =>
            [`${t.name} ${mode}: ${String(text)} on ${String(fill)}`, t[mode], fill, text] as const,
        ),
      ),
    ),
  )(
    '%s clears AA',
    (
      _label,
      palette: ThemePalette,
      fill: keyof ThemePalette,
      text: keyof ThemePalette,
    ) => {
      expect(contrastRatio(palette[fill] as HslColor, palette[text] as HslColor)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('finds a preset by id, and reports a miss', () => {
    expect(findPreset('nord')?.name).toBe('Nord');
    expect(findPreset('not-a-theme')).toBeUndefined();
  });
});

describe('css variable mapping', () => {
  it('converts camelCase tokens to kebab-case variables', () => {
    expect(cssVarName('primaryForeground')).toBe('--primary-foreground');
    expect(cssVarName('background')).toBe('--background');
  });

  it('emits the bare "H S% L%" form Tailwind composes alpha onto', () => {
    // `hsl(var(--primary) / 0.06)` only works if the variable has no hsl() wrapper.
    const value: string = paletteToCssVars(defaultTheme().light)['--primary'];
    expect(value).toMatch(/^[\d.]+ [\d.]+% [\d.]+%$/);
  });

  it('applies and clears every token on an element', () => {
    const el: HTMLDivElement = document.createElement('div');

    applyTheme(defaultTheme(), 'dark', el);
    expect(el.style.getPropertyValue('--background')).toBe('235 18% 13%');
    expect(el.style.getPropertyValue('--radius')).toBe('0.75rem');

    clearTheme(el);
    expect(el.style.getPropertyValue('--background')).toBe('');
    expect(el.style.getPropertyValue('--radius')).toBe('');
  });

  it('applies the mode it is asked for, not the one the document is in', () => {
    const el: HTMLDivElement = document.createElement('div');

    applyTheme(defaultTheme(), 'light', el);

    expect(el.style.getPropertyValue('--background')).toBe('0 0% 100%');
  });
});

describe('hsl conversions', () => {
  it('round-trips hex', () => {
    expect(toHex(fromHex('#6e59a5')!)).toBe('#6e59a5');
  });

  it('round-trips the css value form', () => {
    expect(toCssValue(fromCssValue('257 45% 45%')!)).toBe('257 45% 45%');
  });

  it('rejects malformed input rather than guessing a colour', () => {
    expect(fromHex('nope')).toBeNull();
    expect(fromHex('#12345')).toBeNull();
    expect(fromCssValue('257 45 45')).toBeNull();
  });

  it('handles shorthand hex', () => {
    expect(fromHex('#fff')).toEqual({ h: 0, s: 0, l: 100 });
  });
});

describe('light to dark derivation', () => {
  it('produces a dark background from a light one', () => {
    const dark: ThemePalette = deriveDarkPalette(defaultTheme().light);

    expect(dark.background.l).toBeLessThan(50);
  });

  it('keeps the brand hue rather than inverting it', () => {
    // Inverting hue turns a purple theme green, which is not what "dark mode"
    // means to anyone.
    const light: ThemePalette = defaultTheme().light;
    const dark: ThemePalette = deriveDarkPalette(light);

    expect(Math.abs(dark.primary.h - light.primary.h)).toBeLessThan(20);
  });

  it('still clears AA for body text', () => {
    const dark: ThemePalette = deriveDarkPalette(defaultTheme().light);

    expect(contrastRatio(dark.background, dark.foreground)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('editing rules', () => {
  it('copies a preset rather than editing it', () => {
    const preset: WorkspaceTheme = findPreset('nord')!;

    const editable: WorkspaceTheme = beginEdit(preset);

    expect(editable.isPreset).toBe(false);
    expect(editable.name).toBe('Nord Copy');
    expect(editable.id).not.toBe(preset.id);
    expect(preset.name).toBe('Nord');
  });

  it('numbers repeated copies instead of colliding', () => {
    const preset: WorkspaceTheme = findPreset('nord')!;

    expect(beginEdit(preset, ['Nord Copy']).name).toBe('Nord Copy 2');
    expect(beginEdit(preset, ['Nord Copy', 'Nord Copy 2']).name).toBe('Nord Copy 3');
  });

  it('edits a user theme in place', () => {
    const mine: WorkspaceTheme = beginEdit(findPreset('nord')!);

    expect(beginEdit(mine).id).toBe(mine.id);
  });

  it('re-derives dark when light changes and dark is still derived', () => {
    const theme: { darkIsDerived: boolean; id: string; name: string; isPreset: boolean; icon: WorkspaceIcon; radius: number; light: ThemePalette; dark: ThemePalette; } = { ...beginEdit(findPreset('nord')!), darkIsDerived: true };

    const edited: WorkspaceTheme = setToken(theme, 'light', 'background', { h: 10, s: 50, l: 90 });

    expect(edited.dark).not.toEqual(theme.dark);
    expect(edited.darkIsDerived).toBe(true);
  });

  it('stops re-deriving once dark has been edited by hand', () => {
    const theme: { darkIsDerived: boolean; id: string; name: string; isPreset: boolean; icon: WorkspaceIcon; radius: number; light: ThemePalette; dark: ThemePalette; } = { ...beginEdit(findPreset('nord')!), darkIsDerived: true };

    const handEdited: WorkspaceTheme = setToken(theme, 'dark', 'background', { h: 0, s: 0, l: 5 });
    const thenLight: WorkspaceTheme = setToken(handEdited, 'light', 'background', { h: 10, s: 50, l: 90 });

    expect(handEdited.darkIsDerived).toBe(false);
    // The hand-authored dark survives a later light edit.
    expect(thenLight.dark.background).toEqual({ h: 0, s: 0, l: 5 });
  });

  it('can hand dark back to derivation', () => {
    const theme: { darkIsDerived: boolean; id: string; name: string; isPreset: boolean; icon: WorkspaceIcon; radius: number; light: ThemePalette; dark: ThemePalette; } = { ...beginEdit(findPreset('nord')!), darkIsDerived: false };

    const reset: WorkspaceTheme = resetDarkToDerived(theme);

    expect(reset.darkIsDerived).toBe(true);
    expect(reset.dark).toEqual(deriveDarkPalette(theme.light));
  });

  it('renames a user theme but never a preset', () => {
    const preset: WorkspaceTheme = findPreset('nord')!;
    const mine: WorkspaceTheme = beginEdit(preset);

    expect(canRename(preset)).toBe(false);
    expect(renameTheme(preset, 'Hacked').name).toBe('Nord');
    expect(renameTheme(mine, 'My Theme').name).toBe('My Theme');
  });

  it('refuses an empty rename rather than leaving a nameless theme', () => {
    const mine: WorkspaceTheme = beginEdit(findPreset('nord')!);

    expect(renameTheme(mine, '   ').name).toBe(mine.name);
  });

  it('keeps names unique on rename', () => {
    const mine: WorkspaceTheme = beginEdit(findPreset('nord')!);

    expect(renameTheme(mine, 'Taken', ['Taken']).name).toBe('Taken 2');
  });

  it('uniqueName leaves a free name alone', () => {
    expect(uniqueName('Free', ['Other'])).toBe('Free');
  });
});

describe('buildPalette', () => {
  it('chooses a readable foreground for a light background', () => {
    const palette: ThemePalette = buildPalette(
      { background: { h: 0, s: 0, l: 98 }, primary: { h: 200, s: 60, l: 45 }, primaryAccent: { h: 200, s: 60, l: 40 } },
      'light',
    );

    expect(contrastRatio(palette.background, palette.foreground)).toBeGreaterThanOrEqual(4.5);
  });

  it('elevates cards away from the background in both modes', () => {
    const light: ThemePalette = buildPalette(
      { background: { h: 0, s: 0, l: 98 }, primary: { h: 200, s: 60, l: 45 }, primaryAccent: { h: 200, s: 60, l: 40 } },
      'light',
    );
    const dark: ThemePalette = buildPalette(
      { background: { h: 0, s: 0, l: 13 }, primary: { h: 200, s: 60, l: 55 }, primaryAccent: { h: 200, s: 60, l: 70 } },
      'dark',
    );

    expect(light.card.l).not.toBe(light.background.l);
    // Dark surfaces stack upward: elevation reads as closer to the light.
    expect(dark.card.l).toBeGreaterThan(dark.background.l);
  });
});
