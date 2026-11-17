/**
 * The workspace icon is read from the workspace's metadata, and only ever shown as an image when
 * it is one.
 *
 * Live (owner, 2026-09-27): a workspace had no way to carry an icon, and an emoji icon rendered as
 * a broken image because the switcher put the emoji in an `<img src>`. The icon now lives under
 * the metadata's `logo` key (written by UpdateWorkspaceProfile), beside the theme's emoji.
 *
 * No mocks: pure readers over real metadata bytes.
 */
import { describe, it, expect } from 'vitest';
import { metadataDocument } from '../metadata-document';
import { workspaceLogoOf } from '../workspace-logo';
import { getWorkspaceLogo, type WorkspaceLogo } from '@/lib/workspace-metadata-service';

const PNG: string = 'data:image/png;base64,iVBORw0KGgo=';
const bytes = (doc: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(doc));

describe('the metadata document', () => {
  it('reads every shape the wire and the tabs deliver', () => {
    expect(metadataDocument(bytes({ logo: PNG }))).toEqual({ logo: PNG });
    expect(metadataDocument(Array.from(bytes({ initialized: true })))).toEqual({ initialized: true });
    expect(metadataDocument({ theme: 1 })).toEqual({ theme: 1 });
  });

  it('is empty, not an error, for absent or foreign bytes', () => {
    for (const blank of [undefined, null, new Uint8Array(0), [], new TextEncoder().encode('not json'), bytes([1, 2])]) {
      expect(metadataDocument(blank)).toBeNull();
    }
  });
});

describe('the workspace logo', () => {
  it('is the stored raster data URL', () => {
    expect(workspaceLogoOf(bytes({ logo: PNG }))).toBe(PNG);
  });

  it('is nothing for a cleared, absent, or unsafe value', () => {
    for (const logo of [null, undefined, 42, 'https://evil.example/x.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)']) {
      expect(workspaceLogoOf(bytes({ logo })), String(logo)).toBeNull();
    }
  });

  it('prefers the image, then the theme emoji, then initials', () => {
    const image: WorkspaceLogo = getWorkspaceLogo('Avarok Labs', { emoji: '🚀', color: { h: 0, s: 0, l: 0 } }, PNG);
    const emoji: WorkspaceLogo = getWorkspaceLogo('Avarok Labs', { emoji: '🚀', color: { h: 0, s: 0, l: 0 } }, null);
    const initials: WorkspaceLogo = getWorkspaceLogo('Avarok Labs', undefined, null);
    expect([image, emoji, initials]).toEqual([
      { type: 'image', data: PNG },
      { type: 'emoji', data: '🚀' },
      { type: 'initials', data: 'AL' },
    ]);
  });
});
