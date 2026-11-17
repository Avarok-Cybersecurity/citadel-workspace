/**
 * A node's tabs are derived: page first, chat second exactly when chat is on, then the node's own
 * app tabs or, when it has none, the workspace's default. Nothing invents a default.
 */
import { describe, it, expect } from 'vitest';
import { deriveTabList, readAppTabs, storedTabs, type NodeTab, type StoredTabs, type TabList } from '../tab-list';

const keys = (list: TabList): string[] => list.tabs.map((tab: NodeTab): string => tab.key);
const list = (appIds: string[]): StoredTabs => ({ kind: 'list', appIds });
const ABSENT: StoredTabs = { kind: 'absent' };
const bytes = (doc: unknown): number[] => Array.from(new TextEncoder().encode(JSON.stringify(doc)));

describe('the tab list of a node', () => {
  it('opens with the page, then chat when chat is on, then the app tabs in stored order', () => {
    const derived: TabList = deriveTabList({ chatEnabled: true, node: list(['com.acme.kanban', 'net.avarok.calendar']), workspace: ABSENT });
    expect(keys(derived)).toEqual(['content', 'chat', 'app:com.acme.kanban', 'app:net.avarok.calendar']);
    expect(derived.source).toBe('node');
  });

  it('has no chat tab when chat is off', () => {
    expect(keys(deriveTabList({ chatEnabled: false, node: ABSENT, workspace: list(['net.avarok.calendar']) })))
      .toEqual(['content', 'app:net.avarok.calendar']);
  });

  it('follows the workspace default when the node has no list, and not when it has one', () => {
    const following: TabList = deriveTabList({ chatEnabled: false, node: ABSENT, workspace: list(['net.avarok.calendar']) });
    expect(following.source).toBe('workspace');
    // An empty list is a choice: exactly no app tabs, not "the default".
    const chosen: TabList = deriveTabList({ chatEnabled: false, node: list([]), workspace: list(['net.avarok.calendar']) });
    expect(keys(chosen)).toEqual(['content']);
    expect(chosen.source).toBe('node');
  });

  it('shows page and chat only when neither the node nor the workspace has a list, and says so', () => {
    const none: TabList = deriveTabList({ chatEnabled: true, node: ABSENT, workspace: ABSENT });
    expect(keys(none)).toEqual(['content', 'chat']);
    expect(none.source).toBe('none');
    expect(none.workspaceHasNoDefault).toBe(true);
    expect(deriveTabList({ chatEnabled: true, node: ABSENT, workspace: list([]) }).workspaceHasNoDefault).toBe(false);
  });

  it('refuses a stored list naming the page or chat, which are never stored', () => {
    // The control the design names: `chat` stored in the list must not become a second chat tab.
    const read: StoredTabs = readAppTabs(['chat']);
    expect(read.kind).toBe('refused');
    const derived: TabList = deriveTabList({ chatEnabled: true, node: read, workspace: ABSENT });
    expect(keys(derived)).toEqual(['content', 'chat']);
    expect(derived.refused).toContain('"chat"');
  });

  it('holds a stored list to the server rules: at most eight, distinct, app ids', () => {
    const ids = (n: number): string[] => Array.from({ length: n }, (_v: unknown, i: number): string => `com.acme.app${i}`);
    expect(readAppTabs(ids(8)).kind).toBe('list');
    expect(readAppTabs(ids(9)).kind).toBe('refused');
    expect(readAppTabs(['com.acme.a', 'com.acme.a']).kind).toBe('refused');
    expect(readAppTabs('com.acme.a').kind).toBe('refused');
    expect(readAppTabs(undefined).kind).toBe('absent');
  });

  it('reads the lists from metadata however the bytes arrive', () => {
    expect(storedTabs(bytes({ app_tabs: ['com.acme.kanban'] }), 'app_tabs')).toEqual(list(['com.acme.kanban']));
    expect(storedTabs(new Uint8Array(bytes({ default_app_tabs: [] })), 'default_app_tabs')).toEqual(list([]));
    expect(storedTabs({ app_tabs: ['com.acme.kanban'] }, 'app_tabs')).toEqual(list(['com.acme.kanban']));
    expect(storedTabs([], 'app_tabs')).toEqual(ABSENT);
    expect(storedTabs(undefined, 'default_app_tabs')).toEqual(ABSENT);
  });
});
