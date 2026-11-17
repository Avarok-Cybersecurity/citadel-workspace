/**
 * The theme rides in workspace metadata, which is a general-purpose byte field
 * that outlives the client that wrote it. These cover the round trip and, more
 * importantly, every way the bytes can be wrong — a workspace that will not
 * render is a much worse outcome than one rendering in the default theme.
 */
import { describe, it, expect } from 'vitest';
import { serializeTheme, deserializeTheme, validateTheme } from '../theme-serialization';
import { defaultTheme, findPreset } from '../presets';
import { beginEdit, setToken } from '../theme-editing';
import type { WorkspaceTheme } from '../theme-types';
import type { ThemePalette } from '@/lib/theme/theme-types';

/**
 * What the server stores: one metadata document shared by several features,
 * with the theme envelope merged in under `theme`. Building it here rather than
 * asserting against a bare envelope is the point — the round trip that matters
 * is the one through the shape the workspace actually carries.
 */
function metadataCarrying(theme: WorkspaceTheme): Record<string, unknown> {
  return {
    initialized: true,
    theme: JSON.parse(new TextDecoder().decode(serializeTheme(theme))) as unknown,
  };
}

/** The same document as the bytes a wire decoder hands back. */
function metadataBytes(theme: WorkspaceTheme): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(metadataCarrying(theme)));
}

describe('round trip', () => {
  it('survives serialization unchanged', () => {
    const theme: WorkspaceTheme = defaultTheme();

    expect(deserializeTheme(metadataCarrying(theme))).toEqual(theme);
  });

  it('preserves a user theme, including its edits and derived flag', () => {
    const edited: WorkspaceTheme = setToken(beginEdit(findPreset('nord')!), 'light', 'primary', { h: 12, s: 34, l: 56 });

    const restored: WorkspaceTheme | null = deserializeTheme(metadataCarrying(edited));

    expect(restored).toEqual(edited);
    expect(restored?.light.primary).toEqual({ h: 12, s: 34, l: 56 });
    expect(restored?.isPreset).toBe(false);
  });

  it('preserves an emoji icon and one without', () => {
    const withEmoji: { icon: { emoji: string; color: { h: number; s: number; l: number; }; }; id: string; name: string; isPreset: boolean; radius: number; light: ThemePalette; dark: ThemePalette; darkIsDerived: boolean; } = { ...defaultTheme(), icon: { emoji: '🛡️', color: { h: 10, s: 20, l: 30 } } };

    expect(deserializeTheme(metadataCarrying(withEmoji))?.icon.emoji).toBe('🛡️');
    expect(deserializeTheme(metadataCarrying(defaultTheme()))?.icon.emoji).toBeUndefined();
  });

  it('accepts the plain number[] form a wire decoder may hand back', () => {
    expect(deserializeTheme(Array.from(metadataBytes(defaultTheme())))).toEqual(defaultTheme());
  });

  it('accepts the parsed object the workspace keeps on state', () => {
    // The wire delivers bytes, but the workspace event handler parses metadata
    // and stores an object. Reading only one of the two shapes returned null for
    // the other, which looked exactly like a theme that saved and never came
    // back.
    expect(deserializeTheme(metadataBytes(defaultTheme()))).toEqual(defaultTheme());
    expect(deserializeTheme(metadataCarrying(defaultTheme()))).toEqual(defaultTheme());
  });

  it('reads the theme from a document that carries other features too', () => {
    // The regression this pins: the theme is one key in a shared document, not
    // the whole of it. A save that replaced the document erased
    // `initialized`, and the workspace reopened its setup modal over a working
    // workspace — with a backdrop that swallowed every click.
    const document: Record<string, unknown> = metadataCarrying(defaultTheme());

    expect(document.initialized).toBe(true);
    expect(deserializeTheme(document)).toEqual(defaultTheme());
  });
});

describe('rejecting unusable metadata', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty bytes', new Uint8Array()],
  ])('returns null for %s so the caller can fall back', (_label, input) => {
    expect(deserializeTheme(input as Uint8Array | null | undefined)).toBeNull();
  });

  it('returns null for bytes another feature wrote', () => {
    // metadata is general purpose; someone else's payload landing here is
    // expected rather than exceptional.
    expect(deserializeTheme(new TextEncoder().encode('not json at all'))).toBeNull();
    expect(deserializeTheme(new TextEncoder().encode('{"some":"other feature"}'))).toBeNull();
    // An initialised workspace that has never had a theme set.
    expect(deserializeTheme({ initialized: true })).toBeNull();
  });

  it('refuses a version it does not understand rather than guessing', () => {
    const future: Uint8Array<ArrayBuffer> = new TextEncoder().encode(
      JSON.stringify({ initialized: true, theme: { v: 99, theme: defaultTheme() } }),
    );

    expect(deserializeTheme(future)).toBeNull();
  });
});

describe('validateTheme', () => {
  it('accepts a well-formed theme', () => {
    expect(validateTheme(JSON.parse(JSON.stringify(defaultTheme())))).not.toBeNull();
  });

  it('refuses a palette missing a single token', () => {
    // The important one: a partial palette would apply as an override, leaving
    // that token at whatever the previous theme set — one stray colour with no
    // explanation.
    const broken: ReturnType<typeof JSON.parse> = JSON.parse(JSON.stringify(defaultTheme()));
    delete broken.light.border;

    expect(validateTheme(broken)).toBeNull();
  });

  it('refuses a colour with an out-of-range channel', () => {
    const broken: ReturnType<typeof JSON.parse> = JSON.parse(JSON.stringify(defaultTheme()));
    broken.dark.primary.l = 140;

    expect(validateTheme(broken)).toBeNull();
  });

  it('refuses a colour whose channels are strings', () => {
    const broken: ReturnType<typeof JSON.parse> = JSON.parse(JSON.stringify(defaultTheme()));
    broken.light.primary = { h: '257', s: '45', l: '45' };

    expect(validateTheme(broken)).toBeNull();
  });

  it.each([
    ['id', ''],
    ['name', ''],
  ])('refuses an empty %s', (field, value) => {
    const broken: ReturnType<typeof JSON.parse> = JSON.parse(JSON.stringify(defaultTheme()));
    broken[field] = value;

    expect(validateTheme(broken)).toBeNull();
  });

  it('refuses a negative radius', () => {
    const broken: ReturnType<typeof JSON.parse> = JSON.parse(JSON.stringify(defaultTheme()));
    broken.radius = -1;

    expect(validateTheme(broken)).toBeNull();
  });

  it('refuses a missing icon colour', () => {
    const broken: ReturnType<typeof JSON.parse> = JSON.parse(JSON.stringify(defaultTheme()));
    broken.icon = { emoji: '🛡️' };

    expect(validateTheme(broken)).toBeNull();
  });

  it.each([
    ['a string', 'theme'],
    ['an array', []],
    ['null', null],
  ])('refuses %s', (_label, input) => {
    expect(validateTheme(input)).toBeNull();
  });
});
