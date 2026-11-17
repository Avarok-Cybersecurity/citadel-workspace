/**
 * Layout › Page Setup's choices, each one SetSectionProperty patch: Word's margin presets, its
 * common paper sizes, the two orientations and one to three columns. Pt100 throughout
 * (7200 = one inch). Each choice also says whether it is the caret section's current setup.
 * A paper size is sent with the section's orientation, so a landscape page stays landscape.
 */
import type { Margins, PageSetup, PageSetupPatch, Pt100 } from '@/lib/cdoc/editor/model-values';

export interface PageSetupChoice {
  readonly id: string;
  readonly label: string;
  /** What the choice sets, shown under its name. */
  readonly detail: string;
  /** Whether the section is set up this way now. */
  current(section: PageSetup): boolean;
  /** The patch; null while it cannot be built without the section's setup. */
  patch(section: PageSetup | null): PageSetupPatch | null;
}

const INCH: Pt100 = 7200;
/** Word's header and footer distance, half an inch, in every preset. */
const HEADER_FOOTER: Pt100 = INCH / 2;
/** Word's default gap between columns. */
const COLUMN_GAP: Pt100 = INCH / 2;

function margins(id: string, label: string, topBottom: Pt100, leftRight: Pt100, detail: string): PageSetupChoice {
  const value: Margins = { top: topBottom, bottom: topBottom, left: leftRight, right: leftRight, header: HEADER_FOOTER, footer: HEADER_FOOTER, gutter: 0 };
  return {
    id, label, detail,
    current: (section: PageSetup): boolean => (Object.keys(value) as (keyof Margins)[]).every((k: keyof Margins): boolean => section.margins[k] === value[k]),
    patch: (): PageSetupPatch => ({ margins: value }),
  };
}

export const MARGIN_CHOICES: readonly PageSetupChoice[] = [
  margins('normal', 'Normal', INCH, INCH, '1 in all round'),
  margins('narrow', 'Narrow', INCH / 2, INCH / 2, '0.5 in all round'),
  margins('moderate', 'Moderate', INCH, INCH * 0.75, '1 in top and bottom, 0.75 in sides'),
  margins('wide', 'Wide', INCH, INCH * 2, '1 in top and bottom, 2 in sides'),
];

/** Word stores page sizes in twips; one twip is 5 Pt100. */
const PT100_PER_TWIP: number = 5;
/** A size within a point of a paper's is that paper (a converted document's may round differently). */
const SIZE_TOLERANCE: Pt100 = 100;

/** `width` × `height` are the portrait sheet in Word's twips; a landscape section has them the other way round. */
function paper(id: string, label: string, widthTwips: number, heightTwips: number, detail: string): PageSetupChoice {
  const width: Pt100 = widthTwips * PT100_PER_TWIP;
  const height: Pt100 = heightTwips * PT100_PER_TWIP;
  return {
    id, label, detail,
    current: (section: PageSetup): boolean => {
      const { width: w, height: h } = section.size;
      return Math.abs(Math.min(w, h) - width) <= SIZE_TOLERANCE && Math.abs(Math.max(w, h) - height) <= SIZE_TOLERANCE;
    },
    // The orientation is applied after the size, turning the sheet to the section's.
    patch: (section: PageSetup | null): PageSetupPatch | null => (section === null ? null : {
      size: { width, height, orientation: 'portrait' },
      orientation: section.size.orientation,
    }),
  };
}

export const SIZE_CHOICES: readonly PageSetupChoice[] = [
  paper('letter', 'Letter', 12240, 15840, '8.5 × 11 in'),
  paper('legal', 'Legal', 12240, 20160, '8.5 × 14 in'),
  paper('a4', 'A4', 11906, 16838, '210 × 297 mm'),
  paper('a5', 'A5', 8391, 11906, '148 × 210 mm'),
];

export const ORIENTATION_CHOICES: readonly PageSetupChoice[] = (['portrait', 'landscape'] as const).map((orientation): PageSetupChoice => ({
  id: orientation,
  label: orientation === 'portrait' ? 'Portrait' : 'Landscape',
  detail: orientation === 'portrait' ? 'Taller than wide' : 'Wider than tall',
  current: (section: PageSetup): boolean => section.size.orientation === orientation,
  patch: (): PageSetupPatch => ({ orientation }),
}));

export const COLUMN_CHOICES: readonly PageSetupChoice[] = [1, 2, 3].map((count: number): PageSetupChoice => ({
  id: String(count),
  label: count === 1 ? 'One' : count === 2 ? 'Two' : 'Three',
  detail: count === 1 ? 'One column' : `${count} columns, 0.5 in apart`,
  current: (section: PageSetup): boolean => section.columns.count === count,
  patch: (): PageSetupPatch => ({ columns: { count, gap: COLUMN_GAP, separator: false } }),
}));
