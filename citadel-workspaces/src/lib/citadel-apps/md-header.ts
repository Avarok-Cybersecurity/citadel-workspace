/**
 * A document's hidden required-apps header: its first line, when that line starts with the
 * header prefix, an MDX comment the renderer shows nothing for.
 *
 * Only `split` and `join`: reading the header is the Rust module's (types/src/apps_md_header.rs),
 * and only the kernel writes one. The editor takes the header off the buffer people edit and puts
 * it back, byte for byte, on save, so nobody sees or deletes it. Drift-tested against the shared
 * fixtures the Rust tests generate (citadel-workspace-types/bindings/md-header-fixtures.json).
 */

export const APPS_HEADER_PREFIX: string = '{/* @citadel-apps ';

export interface SplitDocument {
  /** The first line, without its newline, when it is a header candidate. */
  header: string | null;
  body: string;
}

export function splitHeader(content: string): SplitDocument {
  if (!content.startsWith(APPS_HEADER_PREFIX)) return { header: null, body: content };
  const newline: number = content.indexOf('\n');
  if (newline === -1) return { header: content, body: '' };
  return { header: content.slice(0, newline), body: content.slice(newline + 1) };
}

/** `splitHeader`'s inverse; a header always comes back followed by its newline. */
export function joinHeader(header: string | null, body: string): string {
  return header === null ? body : `${header}\n${body}`;
}
