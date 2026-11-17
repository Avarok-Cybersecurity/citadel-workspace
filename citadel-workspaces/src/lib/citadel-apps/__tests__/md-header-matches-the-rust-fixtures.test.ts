/**
 * `splitHeader`/`joinHeader` against the fixtures the Rust module's tests write
 * (citadel-workspace-types/bindings/md-header-fixtures.json): the editor takes off exactly the
 * line the kernel reads as the header, and puts it back byte for byte. And the renderer shows
 * nothing for it: a document with the header renders the same as the document without it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { joinHeader, splitHeader } from '../md-header';
import { renderMdx } from '@/components/office/render-mdx';
import { components } from '@/components/office/mdxComponents';

interface HeaderFixture { name: string; content: string; header: string | null; body: string; joined: string; valid: boolean }

const FIXTURES: string = resolve(__dirname, '../../../../../citadel-workspace-types/bindings/md-header-fixtures.json');
const fixtures: HeaderFixture[] = JSON.parse(readFileSync(FIXTURES, 'utf8')) as HeaderFixture[];
const HEADER: string = '{/* @citadel-apps 1 {"require":[{"app":"com.acme.kanban","min":"1.2.0","surface":"none"}]} */}';

describe('the required-apps header, split and joined as the Rust module does', () => {
  it('has fixtures to compare against, valid and not', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    expect(fixtures.some((f: HeaderFixture) => f.valid)).toBe(true);
    expect(fixtures.some((f: HeaderFixture) => !f.valid)).toBe(true);
  });

  it.each(fixtures.map((f: HeaderFixture): [string, HeaderFixture] => [f.name, f]))('%s', (_name: string, f: HeaderFixture) => {
    expect(splitHeader(f.content)).toEqual({ header: f.header, body: f.body });
    expect(joinHeader(f.header, f.body)).toBe(f.joined);
  });

  it('an edited body keeps the header byte for byte', () => {
    const stored: string = `${HEADER}\n# Board\nold`;
    const { header, body } = splitHeader(stored);
    expect(body).not.toContain('@citadel-apps');
    expect(joinHeader(header, body.replace('old', 'new'))).toBe(`${HEADER}\n# Board\nnew`);
  });
});

describe('the renderer shows nothing for the header', () => {
  // The header line leaves one newline text node between blocks, which draws nothing; markup is
  // compared with inter-tag whitespace collapsed, so any element or visible text still differs.
  const render = async (content: string): Promise<string> =>
    renderToStaticMarkup(createElement('div', null, await renderMdx(content, components, 'http://localhost/'))).replace(/>\s+</g, '><');

  it('a document with the header renders as the same document without it', async () => {
    const body: string = '# Board\n\nThe *plan* for this week.';
    const without: string = await render(body);
    expect(without).toContain('Board');
    expect(await render(`${HEADER}\n${body}`)).toBe(without);
  });

  it('control: a line the renderer does show changes the output', async () => {
    const body: string = '# Board';
    expect(await render(`visible\n${body}`)).not.toBe(await render(body));
  });
});
