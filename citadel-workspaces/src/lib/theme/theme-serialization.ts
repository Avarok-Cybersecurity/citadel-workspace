import type { WorkspaceTheme, ThemePalette, HslColor, WorkspaceIcon } from './theme-types';
import { defaultTheme } from './presets';
import { controlBorderFor } from './palette-contrast';
import { metadataDocument } from '@/lib/workspace-metadata/metadata-document';

/**
 * Carrying a theme in the workspace's `metadata` bytes.
 *
 * UpdateWorkspace already has `metadata: Option<Vec<u8>>`, so the workspace
 * theme needs no protocol change — it rides in the bytes every member already
 * receives with the workspace.
 *
 * JSON rather than CBOR: a theme is numbers and short strings with no BigInt,
 * so the reason the P2P wire uses CBOR does not apply, and a metadata blob that
 * a human can read in a debugger is worth more here than a few saved bytes.
 *
 * The envelope is versioned because this outlives the client that wrote it. A
 * member on an older build must not be handed a payload it silently
 * misinterprets — it gets the default instead, and the workspace still renders.
 */

const ENVELOPE_VERSION: number = 1;

interface ThemeEnvelope {
  v: number;
  theme: unknown;
}

/**
 * The versioned envelope sent to the server, which merges it into the
 * workspace's metadata under a `theme` key — so this is deliberately NOT the
 * whole metadata document that deserializeTheme reads back.
 *
 * The envelope is versioned because it outlives the client that wrote it. A
 * member on an older build must not be handed a payload it silently
 * misinterprets; it gets the default instead, and the workspace still renders.
 */
export function serializeTheme(theme: WorkspaceTheme): Uint8Array {
  const envelope: ThemeEnvelope = { v: ENVELOPE_VERSION, theme };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

/**
 * Read a theme out of a workspace's metadata.
 *
 * `metadata` is a single JSON object shared by several features — initialisation
 * writes `{"initialized": true}` into it — so the theme lives under a `theme`
 * key rather than owning the whole document. The server merges it in on save
 * for the same reason: overwriting the blob erased the initialisation marker and
 * made a configured workspace reopen its setup modal.
 *
 * Both shapes are accepted because both genuinely occur: the wire delivers
 * metadata as bytes, while the workspace event handler parses it and stores an
 * object on state. Accepting only one silently returned null for the other,
 * which is how the theme appeared to save and then never come back.
 *
 * Returns null rather than throwing on anything unusable — absent metadata, a
 * different producer's bytes, a newer envelope version, a malformed palette. The
 * caller falls back to the default, because a workspace that will not render is
 * a far worse outcome than one that renders in the default theme.
 */
export function deserializeTheme(
  metadata: Uint8Array | number[] | Record<string, unknown> | null | undefined,
): WorkspaceTheme | null {
  const document: Record<string, unknown> | null = metadataDocument(metadata);
  if (!document) return null;

  const envelope: unknown = document.theme;
  if (!isRecord(envelope)) return null;
  if (envelope.v !== ENVELOPE_VERSION) return null;

  return validateTheme(envelope.theme);
}

/**
 * Accept a theme only if every field is present and well-formed.
 *
 * Deliberately strict: a palette missing one token would apply as a partial
 * override, leaving that token at whatever the previous theme set — which shows
 * up as one stray colour nobody can explain.
 */
export function validateTheme(value: unknown): WorkspaceTheme | null {
  if (!isRecord(value)) return null;

  const { id, name, isPreset, radius, darkIsDerived } = value;
  if (typeof id !== 'string' || !id) return null;
  if (typeof name !== 'string' || !name) return null;
  if (typeof isPreset !== 'boolean') return null;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) return null;
  if (typeof darkIsDerived !== 'boolean') return null;

  const light: ThemePalette | null = validatePalette(value.light);
  const dark: ThemePalette | null = validatePalette(value.dark);
  const icon: WorkspaceIcon | null = validateIcon(value.icon);
  if (!light || !dark || !icon) return null;

  return { id, name, isPreset, icon, radius, light, dark, darkIsDerived };
}

/** Token keys, taken from a real palette so this cannot drift from the type. */
const TOKEN_KEYS: (keyof ThemePalette)[] = Object.keys(defaultTheme().light) as (keyof ThemePalette)[];

function validatePalette(value: unknown): ThemePalette | null {
  if (!isRecord(value)) return null;

  const palette: ThemePalette = {} as ThemePalette;
  for (const key of TOKEN_KEYS) {
    const color: HslColor | null = validateColor(value[key]);
    if (color) { palette[key] = color; continue; }
    // A theme saved before `controlBorder` existed lacks it. Strict validation would reject the
    // whole theme and silently fall back to the default; derive the edge from the saved colours.
    if (key === 'controlBorder' && value[key] === undefined) continue;
    return null;
  }
  if (!palette.controlBorder) {
    palette.controlBorder = controlBorderFor(palette.ring, [palette.background, palette.card, palette.surface]);
  }
  return palette;
}

function validateColor(value: unknown): HslColor | null {
  if (!isRecord(value)) return null;
  const { h, s, l } = value;
  if (!isFiniteNumber(h) || !isFiniteNumber(s) || !isFiniteNumber(l)) return null;
  // Out-of-range channels mean the producer was not writing an HslColor.
  if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) return null;
  return { h, s, l };
}

function validateIcon(value: unknown): WorkspaceIcon | null {
  if (!isRecord(value)) return null;

  const color: HslColor | null = validateColor(value.color);
  if (!color) return null;

  const emoji: unknown = value.emoji;
  if (emoji !== undefined && typeof emoji !== 'string') return null;

  return emoji === undefined ? { color } : { emoji, color };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
