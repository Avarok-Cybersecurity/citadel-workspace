/**
 * MDX Pre-Processing Utilities
 *
 * Small text transforms applied to raw MDX/markdown content BEFORE the
 * MDX parser runs. Each transform here exists because remark-gfm is not
 * available in the runtime MDX path, so a few GFM features (strike-
 * through, etc.) have to be open-coded.
 *
 * Critically, these transforms must NOT touch the contents of code
 * regions (fenced ```...``` blocks and inline `...` code spans) — doing
 * so would mangle code samples that legitimately contain `~~`. Use the
 * `transformOutsideCode` helper to opt into that behaviour.
 */

/**
 * Matches code regions in priority order:
 *   1. Fenced code blocks: ```...```  (with optional language tag)
 *   2. Inline code spans: `...` (single backtick, no embedded backticks
 *      or newlines).
 *
 * The `g` flag is required so `RegExp.exec` advances past each match.
 */
const CODE_REGION_REGEX: RegExp = /```[\s\S]*?```|`[^`\n]*`/g;

/**
 * Apply `transform` to every span of text that is NOT inside a code
 * region. Code regions are passed through verbatim. Pure function.
 */
export function transformOutsideCode(
  content: string,
  transform: (segment: string) => string,
): string {
  // Reset lastIndex defensively in case the shared regex has state.
  CODE_REGION_REGEX.lastIndex = 0;

  let out: string = '';
  let cursor: number = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_REGION_REGEX.exec(content)) !== null) {
    out += transform(content.slice(cursor, match.index));
    out += match[0];
    cursor = CODE_REGION_REGEX.lastIndex;
  }
  out += transform(content.slice(cursor));
  return out;
}

/**
 * GFM strikethrough: `~~text~~` -> `<del>text</del>`.
 *
 * The lookahead `(?=\S)` and the trailing `\S~~` anchor the match so
 * stray double-tildes (e.g. ASCII art `~~~~`) don't get transformed.
 *
 * The body alternative `(?:[^\n]|\n(?!\n))` permits any non-newline
 * char OR a single newline that is NOT followed by another newline.
 * That matches GFM's "no blank line inside a strikethrough" rule —
 * the previous `[\s\S]*?` body would silently wrap an entire
 * `~~para1\n\npara2~~` block in one `<del>`, which then broke MDX
 * paragraph layout. With the new pattern the regex stops at the
 * first `\n\n` and leaves the trailing `~~ ... ~~` literal.
 *
 * Only applied to non-code regions — see `transformOutsideCode`.
 */
const GFM_STRIKETHROUGH_REGEX: RegExp = /~~(?=\S)((?:[^\n]|\n(?!\n))*?\S)~~/g;

/**
 * Escape characters that have JSX/MDX syntactic meaning when they
 * appear inside the body of a `<del>` we synthesise. Without this,
 * raw inputs like `~~value < 5~~` become `<del>value < 5</del>` —
 * MDX then sees a bare `<` inside what looks like a JSX element and
 * rejects the whole document. The downstream `evaluate()` call in
 * Room.tsx catches the error, but the room renders blank instead
 * of showing the expected struck-through text.
 *
 * We escape `<`/`>` (JSX tag delimiters), `{`/`}` (JSX expression
 * delimiters), and `&` (HTML entity introducer — must come first
 * so the later substitutions don't double-escape `&amp;`).
 */
function escapeMdxText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

export function applyGfmStrikethrough(content: string): string {
  return transformOutsideCode(content, (segment) =>
    segment.replace(
      GFM_STRIKETHROUGH_REGEX,
      (_match, captured: string) => `<del>${escapeMdxText(captured)}</del>`,
    ),
  );
}
