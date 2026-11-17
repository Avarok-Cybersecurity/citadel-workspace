/**
 * The naive block-comment regex treats a glob string as a comment opener and
 * deletes everything to the next close. That silently swallowed the whole
 * esbuild block of vite.config.ts, and the assertion built on it reported "the
 * list is gone" for a list that was right there.
 */
import { describe, it, expect } from 'vitest';
import { stripComments } from '../strip-comments';

const NAIVE = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('stripComments', () => {
  it('removes block and line comments', () => {
    const out: string = stripComments('/* gone */ const a = 1;\n// gone\nconst b = 2;');
    expect(out).not.toMatch(/gone/);
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
  });

  it('survives a glob string, which the naive version does not', () => {
    // Faithful to the real file: a glob, then the code, then a LATER block
    // comment. The glob's `/*` opens a phantom comment and that later `*/`
    // closes it, so everything between — including the code — is deleted.
    // Without the trailing comment there is nothing to close it and the bug
    // does not reproduce, which is how the first version of this test passed.
    const source: string = [
      "globPatterns: ['**/*.{js,css}'],",
      "pure: ['debugLog'],",
      "/** a later doc comment */",
    ].join('\n');

    expect(stripComments(source)).toContain("pure: ['debugLog']");
    // The bug, pinned: the naive strip eats from the glob to the end.
    expect(NAIVE(source)).not.toContain("pure: ['debugLog']");
  });

  it('still strips a comment that follows code on the same line', () => {
    expect(stripComments('const a = 1; /* why */ const b = 2;')).not.toMatch(/why/);
  });
});
