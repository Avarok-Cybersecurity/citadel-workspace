/**
 * A workspace's slug: the `acme` in `acme.work.avarok.net`.
 *
 * The control plane is the authority on which slugs may exist -- it alone knows
 * the reserved names and which are taken, and `GET /api/slug/:slug` asks it.
 * What lives here is the SHAPE, checked in the browser so a visitor sees
 * "letters, numbers and hyphens" as they type rather than a round trip later.
 * The pattern is the control plane's own (`control/slug.mjs`, SLUG_PATTERN):
 * 3 to 32 characters, lowercase letters, digits and hyphens, starting and
 * ending with a letter or digit.
 */

/** Where hosted workspaces live. A tenant is `<slug>.${TENANT_DOMAIN}`. */
export const TENANT_DOMAIN: string = 'work.avarok.net';

export const SLUG_MIN: number = 3;
export const SLUG_MAX: number = 32;

const SLUG_PATTERN: RegExp = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/** Letters NFKD does not decompose: \u00df, \u00e6, \u0153, \u00f8, \u0111, \u0142. */
const LETTER_FOLDS: Readonly<Record<string, string>> = {
  '\u00df': 'ss', '\u00e6': 'ae', '\u0153': 'oe', '\u00f8': 'o', '\u0111': 'd', '\u0142': 'l',
};

export type SlugProblem = 'empty' | 'too-short' | 'too-long' | 'characters' | 'edge-hyphen';

export type SlugShape = { readonly ok: true } | { readonly ok: false; readonly problem: SlugProblem };

/**
 * A slug suggested from the display name: "Acme Robotics, Inc." -> `acme-robotics-inc`.
 *
 * Accents are folded ("Café" -> `cafe`) rather than dropped, anything else that
 * is not a letter or digit becomes a single hyphen, and the result is cut to
 * the maximum length without leaving a hyphen at either end. It may still be
 * too short (a one-letter name); the shape check says so.
 */
export function deriveSlug(displayName: string): string {
  const folded: string = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00df\u00e6\u0153\u00f8\u0111\u0142]/gi, (letter: string) => LETTER_FOLDS[letter.toLowerCase()] ?? letter);
  const hyphenated: string = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return hyphenated.slice(0, SLUG_MAX).replace(/-+$/g, '');
}

/** What a visitor typing into the slug field is allowed to keep: lowercased, spaces as hyphens. */
export function sanitizeSlugInput(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '-');
}

export function checkSlugShape(slug: string): SlugShape {
  if (slug.length === 0) return { ok: false, problem: 'empty' };
  if (/[^a-z0-9-]/.test(slug)) return { ok: false, problem: 'characters' };
  if (slug.length < SLUG_MIN) return { ok: false, problem: 'too-short' };
  if (slug.length > SLUG_MAX) return { ok: false, problem: 'too-long' };
  if (slug.startsWith('-') || slug.endsWith('-')) return { ok: false, problem: 'edge-hyphen' };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, problem: 'characters' };
  return { ok: true };
}

const PROBLEM_TEXT: Readonly<Record<SlugProblem, string>> = {
  empty: 'Choose an address for your workspace.',
  'too-short': `At least ${SLUG_MIN} characters.`,
  'too-long': `At most ${SLUG_MAX} characters.`,
  characters: 'Use lowercase letters, numbers and hyphens only.',
  'edge-hyphen': 'Start and end with a letter or number.',
};

export function describeSlugProblem(problem: SlugProblem): string {
  return PROBLEM_TEXT[problem];
}

export function workspaceHostFor(slug: string): string {
  return `${slug}.${TENANT_DOMAIN}`;
}
