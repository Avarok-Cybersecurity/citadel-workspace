/** Edits to an app-tab list, and which tab a pane opens on. */
import { describe, it, expect, beforeEach } from 'vitest';
import { appendTab, moveTab, removeTab } from '../tab-edits';
import { chooseOpenTab, deepLinkedTab, forgetAllTabs, rememberTab, rememberedTab } from '../tab-memory';
import { deriveTabList, type TabList } from '../tab-list';

const A: string = 'com.acme.a';
const B: string = 'com.acme.b';
const C: string = 'com.acme.c';

describe('an app-tab edit', () => {
  it('appends once, and at most eight', () => {
    expect(appendTab([A], B)).toEqual({ ok: true, appIds: [A, B] });
    expect(appendTab([A], A).ok).toBe(false);
    const eight: string[] = Array.from({ length: 8 }, (_v: unknown, i: number): string => `com.acme.app${i}`);
    expect(appendTab(eight, C).ok).toBe(false);
  });

  it('moves one place, never past either end', () => {
    expect(moveTab([A, B, C], B, -1)).toEqual({ ok: true, appIds: [B, A, C] });
    expect(moveTab([A, B, C], B, 1)).toEqual({ ok: true, appIds: [A, C, B] });
    expect(moveTab([A, B], A, -1).ok).toBe(false);
    expect(moveTab([A, B], B, 1).ok).toBe(false);
  });

  it('removes only a tab that is there', () => {
    expect(removeTab([A, B], A)).toEqual({ ok: true, appIds: [B] });
    expect(removeTab([A], B).ok).toBe(false);
  });
});

describe('the tab a pane opens on', () => {
  const tabs: TabList = deriveTabList({ chatEnabled: true, node: { kind: 'list', appIds: [A] }, workspace: { kind: 'absent' } });
  beforeEach((): void => { forgetAllTabs(); window.history.replaceState(null, '', '/'); });

  it('is the first wanted tab still there, else the page', () => {
    expect(chooseOpenTab(tabs.tabs, ['chat'])).toBe('chat');
    expect(chooseOpenTab(tabs.tabs, [`app:${B}`, `app:${A}`])).toBe(`app:${A}`);
    expect(chooseOpenTab(tabs.tabs, ['app:com.acme.removed', null])).toBe('content');
  });

  it('is remembered per node, in this session only', () => {
    rememberTab('n1', 'chat');
    expect(rememberedTab('n1')).toBe('chat');
    expect(rememberedTab('n2')).toBeNull();
    expect(sessionStorage.getItem('citadel:node-tab:n1')).toBe('chat');
    forgetAllTabs();
    expect(rememberedTab('n1')).toBeNull();
  });

  it('is the deep link’s tab only for the node the link names', () => {
    window.history.replaceState(null, '', `/workspace?nodeId=n1&tab=app:${A}`);
    expect(deepLinkedTab('n1')).toBe(`app:${A}`);
    expect(deepLinkedTab('n2')).toBeNull();
  });
});
