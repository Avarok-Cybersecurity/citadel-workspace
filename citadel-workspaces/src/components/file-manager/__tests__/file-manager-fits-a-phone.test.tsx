/**
 * The file manager at phone width, pinned by mechanism.
 *
 * The earlier storage bar had neither wrap nor scroll, so peers beyond the first
 * were clipped by `main`'s `overflow-x-hidden` and a phone user could not switch
 * storage. These assert the CLASSES that produce the phone layout, because jsdom
 * has no layout -- `getBoundingClientRect` is all zeros, so a geometric assertion
 * here would pass on any markup. The real geometry is measured in the polish
 * harness (scripts/lib/polish-harness/checks-file-manager.mjs) in two engines.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/test-utils/strip-comments';

const read = (p: string): string => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

describe('the top bar', () => {
  const source: string = read('src/components/file-manager/FileManagerTopBar.tsx');

  it('wraps rather than clipping, and gives the filter its own row on a phone', () => {
    expect(source).toMatch(/flex flex-wrap items-center/);
    expect(source).toMatch(/order-last w-full md:order-none/);
  });

  it('shortens the storage labels where they would not fit', () => {
    expect(source).toMatch(/hidden sm:inline">Storage</);
  });

  it('gives the clear-filter button a 24px target', () => {
    expect(source).toMatch(/h-\[24px\] w-\[24px\][^"]*place-items-center/);
  });
});

describe('the address bar', () => {
  it('puts the view controls on their own row on a phone', () => {
    expect(read('src/components/file-manager/FileManagerAddressBar.tsx')).toMatch(/flex min-w-0 flex-1 basis-full items-center gap-\[8px\] md:basis-0/);
  });

  it('collapses the folders between the top and the open one', () => {
    const source: string = read('src/components/file-manager/AddressField.tsx');
    expect(source).toMatch(/i > 0 && !last && 'hidden md:flex'/);
    expect(source).toMatch(/className="flex items-center gap-\[4px\] md:hidden"/);
  });
});

describe('the inspector', () => {
  it('is a sheet on a phone, not a column beside the list', () => {
    const source: string = read('src/components/file-manager/FileManagerBrowser.tsx');
    expect(source).toMatch(/inspected !== null && !phone && /);
    expect(source).toMatch(/inspected !== null && phone && <VFSInspectorSheet/);
  });
});

describe('the P2P chat header', () => {
  it('can actually truncate a long peer name', () => {
    const source: string = read('src/components/p2p/P2PChatHeader.tsx');
    // The truncate was inert without this: a flex item defaults to
    // min-width:auto and never narrows below max-content.
    expect(source).toMatch(/<div className="min-w-0">\s*<h3 className="truncate/);
  });
});
