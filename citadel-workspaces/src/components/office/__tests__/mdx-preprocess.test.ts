import { describe, it, expect } from 'vitest';
import { applyGfmStrikethrough, transformOutsideCode } from '../mdx-preprocess';

describe('applyGfmStrikethrough', () => {
  it('transforms a basic ~~strikethrough~~', () => {
    expect(applyGfmStrikethrough('hello ~~world~~')).toBe('hello <del>world</del>');
  });

  it('transforms multiple occurrences in the same paragraph', () => {
    expect(applyGfmStrikethrough('~~a~~ and ~~b~~')).toBe(
      '<del>a</del> and <del>b</del>',
    );
  });

  it('does NOT touch ~~text~~ inside an inline code span', () => {
    // The literal backtick-delimited segment must come through unchanged.
    const input: "try `~~not strikethrough~~` here" = 'try `~~not strikethrough~~` here';
    expect(applyGfmStrikethrough(input)).toBe(input);
  });

  it('does NOT touch ~~text~~ inside a fenced code block', () => {
    const input: string = [
      'text before',
      '```',
      'console.log(~~"keep me literal"~~);',
      '```',
      'text after with ~~real~~ strikethrough',
    ].join('\n');
    const out: string = applyGfmStrikethrough(input);
    // Fenced block content is preserved verbatim
    expect(out).toContain('console.log(~~"keep me literal"~~);');
    // Strikethrough outside the block IS applied
    expect(out).toContain('<del>real</del>');
  });

  it('handles fenced blocks with a language tag', () => {
    const input: "```ts\nconst x = ~~y~~;\n```\n~~outside~~" = '```ts\nconst x = ~~y~~;\n```\n~~outside~~';
    const out: string = applyGfmStrikethrough(input);
    expect(out).toContain('const x = ~~y~~;');
    expect(out).toContain('<del>outside</del>');
  });

  it('does not transform stray double-tildes (require non-space immediately inside)', () => {
    // The (?=\S)...\S anchors require non-whitespace at both ends.
    expect(applyGfmStrikethrough('~~ not strike ~~')).toBe('~~ not strike ~~');
    expect(applyGfmStrikethrough('~~~~')).toBe('~~~~');
  });

  it('is idempotent on text that contains no ~~ markers', () => {
    const plain: "no markers here, just text and `code` and\n```\nmore code\n```" = 'no markers here, just text and `code` and\n```\nmore code\n```';
    expect(applyGfmStrikethrough(plain)).toBe(plain);
  });

  it('handles unbalanced backticks gracefully (no infinite loop, no exception)', () => {
    // A lone backtick should not start an inline code span (the regex
    // requires `[^`\n]*\``). Strikethrough outside should still apply.
    const input: "unbalanced ` here ~~strike~~ end" = 'unbalanced ` here ~~strike~~ end';
    const out: string = applyGfmStrikethrough(input);
    expect(out).toContain('<del>strike</del>');
  });

  it('escapes < and > inside strikethrough so MDX does not see a bogus JSX tag', () => {
    // The motivating case: `~~value < 5~~` previously produced
    // `<del>value < 5</del>` and MDX rejected the bare `<` as an
    // incomplete JSX element, blanking the room body.
    expect(applyGfmStrikethrough('~~value < 5~~')).toBe(
      '<del>value &lt; 5</del>',
    );
    expect(applyGfmStrikethrough('~~a > b~~')).toBe(
      '<del>a &gt; b</del>',
    );
  });

  it('escapes { and } so MDX does not see a bogus JSX expression', () => {
    expect(applyGfmStrikethrough('~~{x}~~')).toBe(
      '<del>&#123;x&#125;</del>',
    );
  });

  it('escapes & first so HTML entities round-trip rather than double-escaping', () => {
    // `~~A & B~~` must become `<del>A &amp; B</del>`, not
    // `<del>A &amp;amp; B</del>` (which would happen if we ran the
    // < escape before the & escape and mishandled the new ampersands).
    expect(applyGfmStrikethrough('~~A & B~~')).toBe(
      '<del>A &amp; B</del>',
    );
  });

  it('escapes a mixed payload of all special chars in one pass', () => {
    expect(applyGfmStrikethrough('~~a < b & {c} > d~~')).toBe(
      '<del>a &lt; b &amp; {c} &gt; d</del>'.replace('{', '&#123;').replace('}', '&#125;'),
    );
  });

  it('still passes through unaffected text without escaping ordinary punctuation', () => {
    expect(applyGfmStrikethrough('~~the quick fox.~~')).toBe(
      '<del>the quick fox.</del>',
    );
  });

  it('does NOT span a paragraph break', () => {
    // GFM strikethrough body cannot contain a blank line. The
    // previous `[\s\S]*?` body would have wrapped both paragraphs
    // in a single `<del>` and broken MDX paragraph layout.
    const input: "~~para 1\n\npara 2~~" = '~~para 1\n\npara 2~~';
    expect(applyGfmStrikethrough(input)).toBe(input);
  });

  it('allows a single soft line break inside the body', () => {
    // Soft wraps inside a paragraph remain valid GFM strikethrough.
    expect(applyGfmStrikethrough('~~line one\nline two~~')).toBe(
      '<del>line one\nline two</del>',
    );
  });
});

describe('transformOutsideCode', () => {
  it('passes a non-code-only string through `transform` once', () => {
    let count: number = 0;
    const out: string = transformOutsideCode('plain text', (s) => {
      count++;
      return s.toUpperCase();
    });
    expect(out).toBe('PLAIN TEXT');
    expect(count).toBe(1);
  });

  it('preserves code regions verbatim and runs transform on each gap', () => {
    const out: string = transformOutsideCode('a `b` c ```d``` e', (s) =>
      s.replace(/[a-z]/g, (ch) => ch.toUpperCase()),
    );
    expect(out).toBe('A `b` C ```d``` E');
  });

  it('returns empty string for empty input', () => {
    expect(transformOutsideCode('', (s) => `[${s}]`)).toBe('[]');
  });
});
