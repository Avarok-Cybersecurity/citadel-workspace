/**
 * Secrets and content out of a bug report's text, before the person even previews it
 * (RECOVERY-DESIGN.md §3.3). Pure. Structured values are redacted by field name first
 * (redact-secrets.ts, where they are logged); this works on the strings that remain.
 *
 * This is an end-to-end encrypted product, so a report errs towards removing too much: a file's
 * name is content, a long run of letters may be a key, a long number may be an account's CID.
 * The control plane re-scans what arrives with the same shapes (deploy/tenant-worker/control/
 * bug-report-scan.mjs) and refuses a report that still carries one; a parity test holds the two
 * lists equal.
 */

/** One rule: the shape, as a regular expression source with flags `gu`, and what replaces it. */
export interface RedactionRule {
  readonly name: string;
  readonly source: string;
  readonly replace: string;
}

/**
 * Applied in this order. A URL first, so its query and fragment (where tokens and link keys
 * travel) go with it; then the shapes inside free text.
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  { name: 'url', source: String.raw`\b(?:https?|wss?):\/\/[^\s"'<>]+`, replace: '<url>' },
  { name: 'email', source: String.raw`[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}`, replace: '<email>' },
  { name: 'file', source: String.raw`[^\s"'/\\<>]+\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|txt|md|rtf|csv|png|jpe?g|gif|webp|heic|svg|zip|tar|gz|mp3|mp4|mov|wav|key|pages|numbers|cdoc)\b`, replace: '<file>' },
  { name: 'token', source: String.raw`[A-Za-z0-9+/_=-]{24,}`, replace: '<redacted>' },
  { name: 'id', source: String.raw`\b\d{10,}\b`, replace: '<id>' },
  { name: 'phrase', source: String.raw`\b(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}\b`, replace: '<redacted>' },
];

const COMPILED: readonly [RegExp, string][] = REDACTION_RULES.map((rule: RedactionRule): [RegExp, string] => [new RegExp(rule.source, 'gu'), rule.replace]);

export function redactText(text: string): string {
  let out: string = text;
  for (const [pattern, replace] of COMPILED) out = out.replace(pattern, replace);
  return out;
}

/** A page path as a template: the first segment kept, the rest (ids, names) replaced. No query. */
export function routeTemplate(pathname: string): string {
  const [first, ...rest] = pathname.split('/').filter((segment: string): boolean => segment !== '');
  if (first === undefined) return '/';
  return `/${first}${rest.map((): string => '/:id').join('')}`;
}
