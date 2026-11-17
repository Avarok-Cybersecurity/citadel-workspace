/**
 * What a legal document says about itself, read from its own text so the title, version and
 * effective date have no second home to drift in: `# Title`, then `**Version N · Effective DATE**`
 * (or `**Effective DATE**` for the documents that carry no version).
 */
export interface LegalHeading {
  readonly title: string;
  /** `null` for a document that carries no version. */
  readonly version: number | null;
  readonly effective: string;
}

const TITLE: RegExp = /^# (.+)\n/;
const META: RegExp = /^\*\*(?:Version (\d+) · )?Effective ([A-Z][a-z]+ \d{1,2}, \d{4})\*\*\n/;

function parts(text: string): { readonly title: RegExpMatchArray; readonly meta: RegExpMatchArray; readonly rest: string } {
  const title: RegExpMatchArray | null = TITLE.exec(text);
  const afterTitle: string = title === null ? '' : text.slice(title[0].length).replace(/^\n+/, '');
  const meta: RegExpMatchArray | null = META.exec(afterTitle);
  if (title === null || meta === null) throw new Error('A legal document must open with "# Title" and a "**Effective DATE**" line');
  return { title, meta, rest: afterTitle.slice(meta[0].length).replace(/^\n+/, '') };
}

export function headingOf(text: string): LegalHeading {
  const { title, meta } = parts(text);
  return { title: title[1], version: meta[1] === undefined ? null : Number(meta[1]), effective: meta[2] };
}

/** The text after its title and effective-date line, which a page shows as its own header. */
export function bodyOf(text: string): string {
  return parts(text).rest;
}
