/**
 * The values the Home and Layout ribbons offer and how they read the caret's formatting. The
 * lists that are Word's own UI (its size list, its line-spacing list) are stated once here;
 * everything else (font families, styles) comes from the manifests the engine itself reads.
 * Nothing here guesses: with `caretFormatting.known === false`, or a key the engine reports
 * as mixed across the selection, every reader answers "mixed" or null, and the controls
 * render indeterminate.
 */
import type { CaretFormatting, Mark } from '@/lib/cdoc/editor/controller';
import type { ParagraphKey, RunKey } from '@/lib/cdoc/editor/caret-formatting';
import type { Alignment, ParagraphProperties, Pt100, RunPropertiesPatch } from '@/lib/cdoc/editor/model-values';
import type { FontManifest, FontFaceEntry } from '@/lib/cdoc/fonts/font-manifest';

/** Word's font-size list, in the model's half-points (8 pt … 72 pt). */
export const WORD_FONT_SIZES: readonly number[] = [16, 18, 20, 21, 22, 24, 28, 32, 36, 40, 44, 48, 52, 56, 72, 96, 144];

/** Word's line-spacing list, as Multiple in 240ths of a line. */
export const WORD_LINE_SPACINGS: readonly number[] = [240, 276, 360, 480, 600, 720];

export const POINT_IN_PT100: Pt100 = 100;

export type PressedState = boolean | 'mixed';

export function halfPointsLabel(halfPoints: number): string {
  return String(halfPoints / 2);
}

export function lineSpacingLabel(lines: number): string {
  return (lines / 240).toFixed(lines % 24 === 0 ? 1 : 2);
}

/** The next size up Word's list from `halfPoints`, or null at the top of it. */
export function grownSize(halfPoints: number): number | null {
  return WORD_FONT_SIZES.find((s: number): boolean => s > halfPoints) ?? null;
}

/** The next size down Word's list from `halfPoints`, or null at the bottom of it. */
export function shrunkSize(halfPoints: number): number | null {
  const smaller: readonly number[] = WORD_FONT_SIZES.filter((s: number): boolean => s < halfPoints);
  return smaller.length === 0 ? null : smaller[smaller.length - 1];
}

/** The families a document may ask for and be served: every face's family and every alias. */
export function fontFamilies(manifest: FontManifest): readonly string[] {
  const names: Set<string> = new Set<string>([...Object.keys(manifest.aliases), ...manifest.faces.map((f: FontFaceEntry): string => f.family)]);
  return [...names].sort((a: string, b: string): number => a.localeCompare(b));
}

/** The served family a requested one draws in, exactly as the engine resolves it. */
export function servedFamily(requested: string, manifest: FontManifest): string {
  if (manifest.faces.some((f: FontFaceEntry): boolean => f.family === requested)) return requested;
  return manifest.aliases[requested] ?? manifest.fallback;
}

/** The run key each mark reads: sub- and superscript are both `verticalAlign`. */
const MARK_KEYS: Readonly<Record<Mark, RunKey>> = {
  bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', subscript: 'verticalAlign', superscript: 'verticalAlign',
};

function runKnown(caret: CaretFormatting, key: RunKey): caret is Extract<CaretFormatting, { known: true }> {
  return caret.known && !caret.runMixed.has(key);
}

function paragraphKnown(caret: CaretFormatting, key: ParagraphKey): caret is Extract<CaretFormatting, { known: true }> {
  return caret.known && !caret.paragraphMixed.has(key);
}

export function markState(caret: CaretFormatting, mark: Mark): PressedState {
  if (!runKnown(caret, MARK_KEYS[mark])) return 'mixed';
  const run: RunPropertiesPatch = caret.run;
  switch (mark) {
    case 'bold': return run.bold === true;
    case 'italic': return run.italic === true;
    case 'underline': return run.underline !== undefined && run.underline.style !== 'none';
    case 'strike': return run.strike === true;
    case 'subscript': return run.verticalAlign === 'subscript';
    case 'superscript': return run.verticalAlign === 'superscript';
  }
}

export function alignmentState(caret: CaretFormatting, alignment: Alignment): PressedState {
  return paragraphKnown(caret, 'alignment') ? caret.paragraph.alignment === alignment : 'mixed';
}

/** The caret's run value for a picker, or null when it is not known or mixed (an empty picker). */
export function caretRun<K extends RunKey>(caret: CaretFormatting, key: K): NonNullable<RunPropertiesPatch[K]> | null {
  return runKnown(caret, key) ? caret.run[key] ?? null : null;
}

/** The caret paragraph's value, or null when it is not known or mixed. */
export function caretParagraph<K extends ParagraphKey & keyof ParagraphProperties>(caret: CaretFormatting, key: K): NonNullable<ParagraphProperties[K]> | null {
  return paragraphKnown(caret, key) ? caret.paragraph[key] ?? null : null;
}

export function pointsToPt100(points: number): Pt100 {
  return Math.round(points * POINT_IN_PT100);
}

export function pt100ToPoints(value: Pt100): number {
  return value / POINT_IN_PT100;
}
