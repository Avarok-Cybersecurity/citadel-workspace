/**
 * A tree row draws the app's icon for a node only when its metadata decodes to an app: a document
 * node its document app's, an app page the installed app's (its PNG once a listing of it was read
 * in this tab, the generic app icon until then); a plain node, and one whose app record this
 * client cannot read, keep their level's icon. No mocks: the real store, the real component.
 *
 * Negative control (applied, seen red, reverted): returning the level icon for an installed page
 * fails "is the installed app's icon".
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { act, createElement } from 'react';
import { getEntityIcon } from '@/lib/entity-type-registry';
import { nodeIcon } from '../node-icon';
import { encodeNodeApp, encodeNodeAppPage } from '../node-app-metadata';
import { recordAppIcon } from '../installed-app-icons';
import { citadelApp } from '../registry';

const LEVEL: { Child: string } = { Child: 'Floor' };
const bytesOf = (document: unknown): number[] => Array.from(new TextEncoder().encode(JSON.stringify(document)));
/** The smallest PNG header appIconSrc accepts: the eight magic bytes. */
const PNG: string = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

describe('the icon a tree row draws', () => {
  it('is the app icon for a document node', () => {
    expect(nodeIcon({ entity_type: LEVEL, metadata: Array.from(encodeNodeApp(null, 'docs')) })).toBe(citadelApp('docs').icon);
  });

  it('is the installed app’s icon for an app page: generic until its listing is read, then its own', () => {
    const metadata: number[] = Array.from(encodeNodeAppPage(null, { app: 'work.synchronized.app', installId: 'inst-1' }));
    const Icon: ReturnType<typeof nodeIcon> = nodeIcon({ entity_type: LEVEL, metadata });
    expect(Icon).not.toBe(getEntityIcon(LEVEL));
    expect(nodeIcon({ entity_type: LEVEL, metadata })).toBe(Icon);
    const { getByTestId } = render(createElement(Icon, { className: 'h-3 w-3' }));
    expect(getByTestId('installed-app-icon-generic')).toBeTruthy();
    act((): void => recordAppIcon('work.synchronized.app', { png_base64: PNG, max_bytes: 64n }));
    const img: HTMLElement = getByTestId('installed-app-icon');
    expect([img.getAttribute('src'), img.className.includes('h-3 w-3')]).toEqual([`data:image/png;base64,${PNG}`, true]);
  });

  it('is the level icon for a node without an app', () => {
    expect(nodeIcon({ entity_type: LEVEL, metadata: [] })).toBe(getEntityIcon(LEVEL));
    expect(nodeIcon({ entity_type: LEVEL, metadata: [] })).not.toBe(citadelApp('docs').icon);
  });

  it('is the level icon when the app record cannot be read', () => {
    const newer: number[] = bytesOf({ citadel_app: { v: 9, kind: 'citadel-app', payload: { app: 'docs' } } });
    expect(nodeIcon({ entity_type: LEVEL, metadata: newer })).toBe(getEntityIcon(LEVEL));
  });
});
