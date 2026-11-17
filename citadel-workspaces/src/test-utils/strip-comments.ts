/**
 * Remove comments from source text before matching against it.
 *
 * Several guards assert on source, and every one has to strip comments first —
 * this register already records an assertion that matched the comment explaining
 * the code's removal.
 *
 * The naive version, `replace(/\/\*[\s\S]*?\*\//g, '')`, is wrong in a way that
 * is silent and hard to spot: a glob string containing `**` followed by `/*`
 * looks like a comment opener, so the regex deletes everything up to the next
 * close. In vite.config.ts that swallowed the entire esbuild block, and the
 * assertion built on it failed with "the list is gone" for a list that was
 * right there.
 *
 * A block comment's opener is always preceded by start-of-line, whitespace, or
 * an opening bracket — never by another `*`, which is what a glob has. That is
 * not a parser and does not try to be one; it is the smallest rule that tells
 * the two apart for source this project actually contains.
 */
export function stripComments(source: string): string {
  return source
    .replace(/(^|[\s([{,;])\/\*[\s\S]*?\*\//g, '$1')
    .replace(/^\s*\/\/.*$/gm, '');
}
