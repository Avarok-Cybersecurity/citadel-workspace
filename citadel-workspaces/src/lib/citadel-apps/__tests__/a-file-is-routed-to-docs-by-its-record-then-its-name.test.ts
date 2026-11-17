/**
 * Which files open in Citadel Docs: by the Citadel App a file's record names when it names one,
 * otherwise by extension, then MIME type; macro-enabled Word files refused by name; anything
 * else said plainly. And what a download is called. Pure; no mocks.
 */
import { describe, expect, it } from 'vitest';
import { docsFileRoute, exportFileName, type DocsFileRoute } from '../docs-file-kinds';

const route = (name: string, mime: string, app: 'docs' | 'pdf' | null): DocsFileRoute => docsFileRoute({ name, mime, app });

describe('routing a file to Citadel Docs', () => {
  it.each([
    ['report.docx', 'docx'], ['Letterhead.DOTX', 'dotx'], ['minutes.odt', 'odt'], ['README.md', 'md'], ['notes.txt', 'txt'],
  ] as const)('opens %s as %s by its extension', (name: string, format: string) => {
    expect(route(name, '', null)).toEqual({ kind: 'docs', format });
  });

  it('falls back to the MIME type when the name has no known extension', () => {
    expect(route('notes', 'text/markdown', null)).toEqual({ kind: 'docs', format: 'md' });
    expect(route('scan', 'application/vnd.oasis.opendocument.text', null)).toEqual({ kind: 'docs', format: 'odt' });
  });

  it('follows the app record over the extension', () => {
    expect(route('report.docx', '', 'pdf')).toEqual({ kind: 'unsupported', reason: 'It belongs to another Citadel App (pdf).' });
    expect(route('README.md', '', 'docs')).toEqual({ kind: 'docs', format: 'md' });
  });

  it('refuses macro-enabled Word files by extension or MIME type', () => {
    expect(route('budget.docm', '', null)).toEqual({ kind: 'macro-enabled' });
    expect(route('budget', 'application/vnd.ms-word.document.macroEnabled.12', null)).toEqual({ kind: 'macro-enabled' });
    expect(route('form.dotm', '', 'docs')).toEqual({ kind: 'macro-enabled' });
  });

  it('says what it opens when it does not open a file', () => {
    expect(route('photo.png', 'image/png', null)).toEqual({ kind: 'unsupported', reason: 'Citadel Docs opens .docx, .dotx, .odt, .md and .txt files; this is a .png file.' });
    expect(route('Makefile', 'application/octet-stream', null)).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('a file with no extension') });
  });
});

describe('naming a download', () => {
  it('replaces a Docs extension the title carries and keeps any other', () => {
    expect(exportFileName('report.docx', 'pdf')).toBe('report.pdf');
    expect(exportFileName('Quarterly plan', 'md')).toBe('Quarterly plan.md');
    expect(exportFileName('v1.2 notes', 'txt')).toBe('v1.2 notes.txt');
  });
});
