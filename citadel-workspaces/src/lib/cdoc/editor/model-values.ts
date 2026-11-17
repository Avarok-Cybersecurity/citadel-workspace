/**
 * The model values some editor commands carry (`value` in citadel-docs docs/edit-commands.md):
 * the JSON shape of cdoc-model's `RunProperties`, `ParagraphProperties` and `Comment`, which
 * the encoder writes in the cdoc_crdt codec, never as JSON text. Every field is optional in a
 * patch: a set field applies, an absent one is kept. Units are the model's own integers.
 */

/** An opaque sRGB colour, `#RRGGBB`. */
export type HexColor = `#${string}`;

/** `value` as a HexColor; throws when it is not `#RRGGBB`. */
export function hexColor(value: string): HexColor {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`not a hex colour: ${value}`);
  return value as HexColor;
}

/** Hundredths of a point (7200 = one inch); an integer that fits an i32. */
export type Pt100 = number;

export type UnderlineStyle = 'none' | 'single' | 'double' | 'thick' | 'dotted' | 'dashed' | 'wave' | 'words';
export type VerticalAlign = 'baseline' | 'superscript' | 'subscript';

export interface RunPropertiesPatch {
  readonly style?: string;
  readonly font?: string;
  /** Half-points: 24 is 12 pt. */
  readonly size?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: { readonly style: UnderlineStyle; readonly color?: HexColor };
  readonly strike?: boolean;
  readonly verticalAlign?: VerticalAlign;
  readonly color?: HexColor;
  readonly highlight?: HexColor;
  readonly smallCaps?: boolean;
  readonly allCaps?: boolean;
  /** Kerning from this size up, in half-points; 0 switches it off. */
  readonly kern?: number;
  readonly ligatures?: Ligatures;
  /** BCP 47 (`de-DE`): the language the text is hyphenated in. */
  readonly lang?: string;
}

/** Word's `w14:ligatures` sets, as cdoc-model spells them. */
export type Ligatures =
  | 'none' | 'standard' | 'contextual' | 'historical' | 'discretional' | 'standardContextual' | 'standardHistorical'
  | 'contextualHistorical' | 'standardDiscretional' | 'contextualDiscretional' | 'historicalDiscretional'
  | 'standardContextualHistorical' | 'standardContextualDiscretional' | 'standardHistoricalDiscretional'
  | 'contextualHistoricalDiscretional' | 'all';

export type Alignment = 'left' | 'center' | 'right' | 'justify';

export type LineSpacing =
  /** 240ths of a line: 240 single, 276 is 1.15, 360 is 1.5, 480 double. */
  | { readonly rule: 'multiple'; readonly lines: number }
  | { readonly rule: 'exact'; readonly height: Pt100 }
  | { readonly rule: 'atLeast'; readonly height: Pt100 };

export type FirstLine = { readonly kind: 'indent'; readonly by: Pt100 } | { readonly kind: 'hanging'; readonly by: Pt100 };

export type Spacing = { readonly before?: Pt100; readonly after?: Pt100; readonly line?: LineSpacing };
export type Indent = { readonly left?: Pt100; readonly right?: Pt100; readonly firstLine?: FirstLine };

/**
 * `ParagraphProperties` as the editor reports them (formatting at the caret), less `borders`
 * and `shading`, which no command surface reads yet; add them in the model's shape when one does.
 */
export interface ParagraphProperties {
  readonly style?: string;
  readonly alignment?: Alignment;
  readonly spacing?: Spacing;
  readonly indent?: Indent;
  readonly keepWithNext?: boolean;
  readonly keepLines?: boolean;
  readonly pageBreakBefore?: boolean;
  readonly numbering?: { readonly numId: number; readonly level: number };
  readonly outlineLevel?: number;
  readonly suppressAutoHyphens?: boolean;
}

/** A field of a patch: absent keeps the current value, a value sets it, null clears it. */
type Patched<T> = T | null;

/**
 * `RunPatch` (docs/edit-commands.md v3), what SetRunProperty takes: each field absent (keep), a
 * value (set) or null (clear the direct property, back to what the styles give). Clear
 * Formatting is CLEAR_ALL_RUN_PROPERTIES.
 */
export type RunPatch = { readonly [K in keyof RunPropertiesPatch]?: Patched<NonNullable<RunPropertiesPatch[K]>> };

/**
 * `ParagraphPatch` (docs/edit-commands.md v2): each field absent (keep), a value (set) or null
 * (clear, so the style's value shows). `spacing` and `indent` are patched field by field.
 */
export interface ParagraphPatch {
  readonly style?: Patched<string>;
  readonly alignment?: Patched<Alignment>;
  readonly spacing?: Patched<{ readonly before?: Patched<Pt100>; readonly after?: Patched<Pt100>; readonly line?: Patched<LineSpacing> }>;
  readonly indent?: Patched<{ readonly left?: Patched<Pt100>; readonly right?: Patched<Pt100>; readonly firstLine?: Patched<FirstLine> }>;
  readonly keepWithNext?: Patched<boolean>;
  readonly keepLines?: Patched<boolean>;
  readonly pageBreakBefore?: Patched<boolean>;
  readonly numbering?: Patched<{ readonly numId: number; readonly level: number }>;
  readonly outlineLevel?: Patched<number>;
  readonly suppressAutoHyphens?: Patched<boolean>;
}

export type Orientation = 'portrait' | 'landscape';
export interface PageSize { readonly width: Pt100; readonly height: Pt100; readonly orientation: Orientation }
export interface Margins {
  readonly top: Pt100; readonly bottom: Pt100; readonly left: Pt100; readonly right: Pt100;
  readonly header: Pt100; readonly footer: Pt100; readonly gutter: Pt100;
}
export interface Columns { readonly count: number; readonly gap: Pt100; readonly separator: boolean }
export type NumberFormat = 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' | 'bullet' | 'none';

/** cdoc-model's PageSetup: the caret's section, what Page Setup shows (result record v4). */
export interface PageSetup {
  readonly size: PageSize;
  readonly margins: Margins;
  readonly columns: Columns;
  /** `start` absent: numbering continues from the previous section. */
  readonly pageNumbering: { readonly format: NumberFormat; readonly start?: number };
}

/** `PageSetupPatch`: an absent field keeps the section's value, a present one replaces it whole. */
export interface PageSetupPatch {
  readonly size?: PageSize;
  /** Applied after `size`: swaps width and height when the paper has the other orientation. */
  readonly orientation?: Orientation;
  readonly margins?: Margins;
  readonly columns?: Columns;
}

/** A comment or reply; `date` is RFC 3339, `parent` names the comment replied to. */
export interface CommentValue {
  readonly id: string;
  readonly author: string;
  readonly date: string;
  readonly text: string;
  readonly resolved: boolean;
  readonly parent?: string;
}
