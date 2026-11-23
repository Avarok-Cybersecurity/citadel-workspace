/**
 * An installed Citadel App is offered for the files its signed manifest declares on its node tab,
 * under its own name, and a file opened in it is handed over and its tab shown; the person's last
 * choice on this device is kept per extension. Pure values and the real inbox; the only stand-ins
 * are a `Storage` (jsdom's own) and the navigation, which is recorded.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppListing, FileOpens, InstallScope } from 'citadel-workspace-client-ts';
import { installOf, listingOf, type ManifestChanges } from '@/test/app-manifests';
import { listedApps, type ListedApp } from '../../listing-model';
import { OpenedFiles, type OpenedFile } from '../../runtime/opened-files';
import { BUILT_IN_OPENERS } from '../built-in-openers';
import { appTabPath, installedOpeners, type InstalledApp } from '../installed-openers';
import { lastChoicesIn, type LastChoices } from '../last-choice';
import { openInInstalled, type InstalledOpening } from '../open-installed';
import { openersFor, type FileOpener } from '../openers';

const ICS: FileOpens = { extensions: ['ics'], surface: 'node_tab', max_bytes: 8n };
const app = (id: string, changes: ManifestChanges, scope: InstallScope = 'Workspace', source: AppListing['source'] | null = null): InstalledApp => {
  const listing: AppListing = listingOf({ id, surfaces: ['node_tab', 'md_zone'], ...changes });
  const [listed]: ListedApp[] = listedApps([source === null ? listing : { ...listing, source }]);
  if (listed === undefined) throw new Error(`${id}'s listing does not read`);
  return { install: installOf(id, scope), app: listed };
};
type Installed = Extract<FileOpener, { kind: 'installed' }>;

describe('installed apps as openers', () => {
  it('are the apps whose manifest opens files on their node tab, named and placed by their install', () => {
    const openers: Installed[] = installedOpeners([
      app('net.avarok.calendar', { name: 'Calendar', opens: ICS }, 'Workspace', 'FirstParty'),
      app('com.acme.planner', { name: 'Planner', opens: ICS }, { NodeTree: 'n7' }),
      app('com.acme.zoned', { name: 'Zoned', opens: { ...ICS, surface: 'md_zone' } }),
      app('com.acme.none', { name: 'None' }),
      app('com.acme.planner', { name: 'Planner again', opens: ICS }, { Node: 'n9' }),
    ]);
    expect(openers.map((o: Installed) => [o.id, o.name, o.firstParty, o.opens, o.maxBytes, o.where])).toEqual([
      ['net.avarok.calendar', 'Calendar', true, ['ics'], 8n, null],
      ['com.acme.planner', 'Planner', false, ['ics'], 8n, 'n7'],
    ]);
  });

  it('sit beside the built-in apps, the first-party one first, unless the person last chose another', () => {
    const openers: FileOpener[] = [...BUILT_IN_OPENERS, ...installedOpeners([
      app('com.acme.planner', { name: 'Planner', opens: ICS }),
      app('net.avarok.calendar', { name: 'Calendar', opens: ICS }, 'Workspace', 'FirstParty'),
    ])];
    expect(openersFor('team.ics', openers, null).apps.map((o: FileOpener) => o.name)).toEqual(['Calendar', 'Planner']);
    expect(openersFor('team.ics', openers, 'com.acme.planner').apps.map((o: FileOpener) => o.name)).toEqual(['Planner', 'Calendar']);
  });
});

describe('opening a file in an installed app', () => {
  const [calendar, planner]: Installed[] = installedOpeners([
    app('net.avarok.calendar', { name: 'Calendar', opens: ICS }, 'Workspace', 'FirstParty'),
    app('com.acme.planner', { name: 'Planner', opens: ICS }, { Node: 'n7' }),
  ]);
  let inbox: OpenedFiles;
  let went: string[];
  const opening = (fallbackNode: string | null): InstalledOpening => ({ inbox, go: (path: string): void => { went.push(path); }, fallbackNode });
  const taken = (appId: string): OpenedFile[] => { const got: OpenedFile[] = []; inbox.take(appId, (f: OpenedFile): void => { got.push(f); })(); return got; };
  const bytes: Uint8Array = new Uint8Array([1, 2, 3]);
  beforeEach((): void => { inbox = new OpenedFiles(); went = []; });

  it('hands the file to the app and shows its tab on its install\'s node, or the first space for a workspace-wide one', async () => {
    expect(await openInInstalled(planner!, { name: 'a.ics', mime: 'text/calendar' }, async () => bytes, opening('n1'))).toBeNull();
    expect(await openInInstalled(calendar!, { name: 'b.ics', mime: '' }, async () => bytes, opening('n1'))).toBeNull();
    expect(went).toEqual([appTabPath('n7', 'com.acme.planner'), appTabPath('n1', 'net.avarok.calendar')]);
    expect(went[1]).toBe('/workspace?nodeId=n1&tab=app%3Anet.avarok.calendar');
    expect(taken('com.acme.planner')).toEqual([{ name: 'a.ics', mime: 'text/calendar', bytes }]);
    expect(taken('net.avarok.calendar')).toEqual([{ name: 'b.ics', mime: '', bytes }]);
  });

  it('hands over nothing, and goes nowhere, for a file over the app\'s size or with no page to show it on', async () => {
    expect(await openInInstalled(calendar!, { name: 'big.ics', mime: '' }, async () => new Uint8Array(9), opening('n1'))).toBe('big.ics is larger than Calendar opens');
    expect(await openInInstalled(calendar!, { name: 'b.ics', mime: '' }, async () => bytes, opening(null))).toBe('Calendar opens files in a page\'s tab, and there is no page here to open it on');
    expect(went).toEqual([]);
    expect(taken('net.avarok.calendar')).toEqual([]);
  });
});

describe('the last choice on this device', () => {
  beforeEach((): void => { localStorage.clear(); });

  it('is kept per extension, and is nothing for a file without one', () => {
    const choices: LastChoices = lastChoicesIn((): Storage => localStorage);
    choices.choose('ics', 'com.acme.planner');
    choices.choose('', 'com.acme.planner');
    expect([choices.of('ics'), choices.of('md'), choices.of('')]).toEqual(['com.acme.planner', null, null]);
  });

  it('is nothing, and throws nothing, where storage is absent or refuses', () => {
    const refusing: Storage = { ...localStorage, getItem: (): string => { throw new Error('blocked'); }, setItem: (): void => { throw new Error('full'); } };
    for (const choices of [lastChoicesIn((): null => null), lastChoicesIn((): Storage => refusing)]) {
      expect((): void => choices.choose('ics', 'x')).not.toThrow();
      expect(choices.of('ics')).toBeNull();
    }
  });
});
