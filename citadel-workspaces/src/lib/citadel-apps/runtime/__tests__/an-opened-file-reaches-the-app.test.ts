/**
 * A file a member opens in an installed app reaches its running instance as AppEvent `open_file`,
 * in the bytes the Rust SDK decodes (citadel-app-sdk-types/tests/wire.rs pins the same literal),
 * through the production mount and worker host, and only as the app's signed `opens` allows: its
 * listed extensions, its size ceiling, and the surface it said it opens files on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSurface, FileOpens } from 'citadel-workspace-client-ts';
import type { AppZoneHandle } from '@/components/office/app-zone/app-zone-environment';
import { until } from '../../host/__tests__/in-process';
import { appModule } from '../../host/__tests__/app-fixtures';
import { encodeAppEvent } from '../../host/app-event';
import { decodeCbor, type Decoded } from '../../host/cbor';
import type { ToWorker } from '../../host/worker-protocol';
import type { OpenedFile } from '../opened-files';
import { APP_ID, FakeRuntimeKernel, hostOf, release, rig, slotsOf, tabOf, type Rig } from './runtime-rig';

const ICS: FileOpens = { extensions: ['ics'], surface: 'node_tab', max_bytes: 16n };
const TAB: AppSurface[] = ['node_tab'];
const invite: OpenedFile = { name: 'Team.ICS', mime: 'text/calendar', bytes: new Uint8Array([66, 69, 71, 73, 78]) };

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});

function openedEvents(r: Rig): unknown[] {
  return r.sent.flatMap((m: ToWorker): unknown[] => {
    if (m.kind !== 'event') return [];
    const decoded: Decoded = decodeCbor(m.event);
    if (!decoded.ok) throw new Error('an event does not decode');
    const value: unknown = decoded.value;
    return typeof value === 'object' && value !== null && 'open_file' in value ? [value] : [];
  });
}

async function runningTab(opens: FileOpens | undefined, surfaces: AppSurface[] = TAB): Promise<{ r: Rig; close: () => Promise<void> }> {
  const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [], { surfaces, opens }));
  const r: Rig = rig(kernel);
  rigs.push(r);
  const host: HTMLDivElement = hostOf(320, 400);
  const zone: AppZoneHandle = r.runtime.mountPane(slotsOf(host), tabOf(kernel.rel));
  await until(() => host.dataset.appState === 'running', 4000);
  return { r, close: () => zone.close('unmount') };
}

const settle = (): Promise<void> => new Promise<void>((done) => setTimeout(done, 50));

describe('a file opened in an installed app', () => {
  it('is encoded exactly as the SDK reads it', () => {
    expect([...encodeAppEvent({ open_file: { name: 'a.md', mime: '', bytes: new Uint8Array([35, 10]) } })]).toEqual([
      0xa1, 0x69, ...new TextEncoder().encode('open_file'), 0xa3,
      0x64, ...new TextEncoder().encode('name'), 0x64, ...new TextEncoder().encode('a.md'),
      0x64, ...new TextEncoder().encode('mime'), 0x60,
      0x65, ...new TextEncoder().encode('bytes'), 0x42, 0x23, 0x0a,
    ]);
  });

  it('reaches the running instance once, whether offered before it ran or while it runs', async () => {
    const { r } = await runningTab(ICS);
    r.opened.offer(APP_ID, invite);
    await settle();
    expect(openedEvents(r)).toEqual([{ open_file: { name: 'Team.ICS', mime: 'text/calendar', bytes: invite.bytes } }]);

    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [], { surfaces: TAB, opens: ICS }));
    const early: Rig = rig(kernel);
    rigs.push(early);
    early.opened.offer(APP_ID, invite);
    const host: HTMLDivElement = hostOf(320, 400);
    early.runtime.mountPane(slotsOf(host), tabOf(kernel.rel));
    await until(() => host.dataset.appState === 'running', 4000);
    await settle();
    expect(openedEvents(early)).toHaveLength(1);
  });

  it('is not handed over past what the app declared (control: the declared file is)', async () => {
    const cases: [FileOpens | undefined, AppSurface[], OpenedFile, string][] = [
      [undefined, TAB, invite, 'opens no files'],
      [ICS, TAB, { ...invite, name: 'notes.md' }, 'does not open .md files'],
      [ICS, TAB, { ...invite, name: 'invite' }, 'without an extension'],
      [ICS, TAB, { ...invite, bytes: new Uint8Array(17) }, 'larger than the 16 bytes'],
      [{ ...ICS, surface: 'md_zone' }, ['node_tab', 'md_zone'], invite, 'on md_zone, not on node_tab'],
    ];
    for (const [opens, surfaces, file, why] of cases) {
      const { r } = await runningTab(opens, surfaces);
      r.opened.offer(APP_ID, file);
      await settle();
      expect(openedEvents(r), why).toEqual([]);
      expect(r.reports.join('\n'), why).toContain(why);
    }
    const { r } = await runningTab(ICS);
    r.opened.offer(APP_ID, { ...invite, bytes: new Uint8Array(16) });
    await settle();
    expect(openedEvents(r)).toHaveLength(1);
  });

  it('waits for the next instance once the tab has closed', async () => {
    const { r, close } = await runningTab(ICS);
    await close();
    r.opened.offer(APP_ID, invite);
    await settle();
    expect(openedEvents(r)).toEqual([]);
    const taken: OpenedFile[] = [];
    r.opened.take(APP_ID, (file: OpenedFile): void => { taken.push(file); });
    expect(taken).toEqual([invite]);
  });
});
