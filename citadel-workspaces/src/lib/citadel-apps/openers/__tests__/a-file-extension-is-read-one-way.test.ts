/**
 * A file's extension as every "which app opens this" decision reads it (file-extension.ts): the
 * text after the last dot, lower-cased, and none for a name without a dot or for a dotfile.
 */
import { describe, expect, it } from 'vitest';
import { extensionOf } from '../file-extension';

describe('a file name\'s extension', () => {
  it('is the text after the last dot, lower-cased', () => {
    expect([extensionOf('notes.md'), extensionOf('Team.ICS'), extensionOf('a.tar.gz')]).toEqual(['md', 'ics', 'gz']);
  });

  it('is none for a name without a dot, a dotfile, or a name ending in a dot', () => {
    expect([extensionOf('README'), extensionOf('.env'), extensionOf('draft.')]).toEqual(['', '', '']);
  });
});
