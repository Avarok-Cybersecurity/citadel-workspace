/**
 * Formatting where the selection starts, from the result record (v6) (docs/edit-commands.md):
 * for a collapsed selection what the next typed text gets, for a range its first character's.
 * The ribbons render pressed states from the effective (cascaded) values and the
 * indeterminate state (aria-pressed="mixed") from the mixed sets.
 */
import type { PageSetup, ParagraphProperties, RunPatch, RunPropertiesPatch } from './model-values';
import type { ListKind } from './editor-commands';

/**
 * The list the paragraph where the selection starts belongs to (result record v6): which
 * built-in template its definition is, or `custom` for any other (an imported list, or one
 * edited level by level), and the paragraph's level, 0..=8.
 */
export interface ListState {
  readonly kind: ListKind | 'custom';
  readonly level: number;
}

/** Bit order of the run_mixed set: bit i is RUN_KEYS[i]. */
export const RUN_KEYS = [
  'style', 'font', 'size', 'bold', 'italic', 'underline', 'strike', 'verticalAlign', 'color', 'highlight', 'smallCaps', 'allCaps',
  'kern', 'ligatures', 'lang',
] as const;
/** Bit order of the paragraph_mixed set: bit i is PARAGRAPH_KEYS[i]. */
export const PARAGRAPH_KEYS = [
  'style', 'alignment', 'spacing', 'indent', 'borders', 'shading', 'keepWithNext', 'keepLines', 'pageBreakBefore', 'numbering', 'outlineLevel',
  'suppressAutoHyphens',
] as const;

export type RunKey = (typeof RUN_KEYS)[number];

/** RUN_KEYS is exactly RunProperties' fields: a key added to one and not the other is a type error. */
const RUN_KEYS_ARE_THE_FIELDS: [RunKey, keyof RunPropertiesPatch] extends [keyof RunPropertiesPatch, RunKey] ? true : never = true;
void RUN_KEYS_ARE_THE_FIELDS;

/** Clear Formatting: every run property null, back to what the styles give (RunPatch::clear_all). */
export const CLEAR_FORMATTING: RunPatch = Object.fromEntries(RUN_KEYS.map((key: RunKey): [RunKey, null] => [key, null]));
export type ParagraphKey = (typeof PARAGRAPH_KEYS)[number];

export interface KnownFormatting {
  readonly known: true;
  /** RunProperties after the cascade: what a toggle shows as pressed. */
  readonly run: RunPropertiesPatch;
  /** RunProperties set directly on the run. */
  readonly runDirect: RunPropertiesPatch;
  /** ParagraphProperties after the cascade; `style` is the paragraph style id, `numbering` the list. */
  readonly paragraph: ParagraphProperties;
  readonly paragraphDirect: ParagraphProperties;
  /** Keys whose effective value differs somewhere in the selected text; empty when collapsed. */
  readonly runMixed: ReadonlySet<RunKey>;
  /** Keys whose effective value differs between the selected paragraphs; empty when collapsed. */
  readonly paragraphMixed: ReadonlySet<ParagraphKey>;
  /** The caret's section: what Page Setup shows (result record v4). */
  readonly section: PageSetup;
  /** Null for a paragraph that is not a list item. */
  readonly list: ListState | null;
  /** Another selected paragraph has a different list kind or level, or none: Bullets and Numbering show mixed. */
  readonly listMixed: boolean;
}

/**
 * `known: false` only before the first result (a replica just opened reports its selection
 * through awareness, which carries no formatting); ribbons show it as indeterminate.
 */
export type CaretFormatting = { readonly known: false } | KnownFormatting;
