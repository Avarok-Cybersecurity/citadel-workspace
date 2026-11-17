/**
 * An app's toolbar (`ui.set_toolbar`) is the host's: real buttons above the zone with the app's
 * labels as plain text, replaced whole by each update, bounded in one place (toolbar-model.ts),
 * and a press reaches the app as `ui_action` only while it runs. The app is a hand-built module in
 * the production worker host (in process): app_init sets the toolbar (`ui` is intrinsic, so
 * never ungranted), and every event it is handed makes one storage call, so the kernel's call
 * count is what the app heard.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AppZoneHandle } from '@/components/office/app-zone/app-zone-environment';
import { encodeCbor } from '../../host/cbor';
import { until } from '../../host/__tests__/in-process';
import { appModule, callGroup, type AppModuleOptions } from '../../host/__tests__/app-fixtures';
import { MAX_TOOLBAR_ITEMS, MAX_TOOLBAR_LABEL_CHARS, readToolbar } from '../toolbar-model';
import { zoneUiPort } from '../ui-port';
import { zoneToolbar, type ZoneToolbar } from '../zone-toolbar';
import type { UiPort } from '../../host/ports';
import type { ToolbarItem } from '../../sdk/generated/ToolbarItem';
import type { ZoneHost } from '@/components/office/app-zone/app-zone-environment';
import { FakeRuntimeKernel, hostOf, release, rig, slotsOf, zoneOf, type Rig } from './runtime-rig';

const TOOLBAR_AT: number = 1024;
const KV_AT: number = 2048;
const TOOLBAR: Uint8Array = encodeCbor({ items: [{ id: 'run', label: 'Run <b>job</b>', icon_name: null }, { id: 'stop', label: 'Stop', icon_name: null }] });
const KV: Uint8Array = encodeCbor({ backend: 'user', key: 'k' });

function toolbarApp(): Uint8Array {
  const base: AppModuleOptions = { groups: ['ui', 'storage'] };
  return appModule({
    ...base,
    init: [...callGroup(base, 'ui', 1, TOOLBAR_AT, TOOLBAR.byteLength), 0x41, 0x00],
    event: callGroup(base, 'storage', 1, KV_AT, KV.byteLength),
    data: [{ offset: TOOLBAR_AT, bytes: TOOLBAR }, { offset: KV_AT, bytes: KV }],
  });
}

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});

async function running(): Promise<{ kernel: FakeRuntimeKernel; zone: AppZoneHandle; host: HTMLDivElement; bar: HTMLElement }> {
  const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(toolbarApp(), ['storage.user']));
  const r: Rig = rig(kernel);
  rigs.push(r);
  const host: HTMLDivElement = hostOf(375);
  const slots: ZoneHost = slotsOf(host);
  const zone: AppZoneHandle = r.runtime.mount(slots, zoneOf(kernel.rel));
  await until(() => host.dataset.appState === 'running', 4000);
  await new Promise<void>((done) => setTimeout(done, 50));
  return { kernel, zone, host, bar: slots.toolbar };
}

const buttons = (bar: HTMLElement): HTMLButtonElement[] => [...bar.querySelectorAll('button')];

describe('an app’s toolbar', () => {
  it('is host buttons above the zone, named by labels set as text', async () => {
    const { bar, host } = await running();
    const shown: HTMLButtonElement[] = buttons(bar);
    expect(shown.map((b) => [b.type, b.textContent, b.dataset.itemId])).toEqual([['button', 'Run <b>job</b>', 'run'], ['button', 'Stop', 'stop']]);
    expect(bar.querySelector('b')).toBeNull();
    expect(bar.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Kanban actions');
    expect(host.contains(bar)).toBe(false);
    expect(shown.every((b) => b.className.includes('min-h-[44px]'))).toBe(true);
  });

  it('a press reaches the app as an event; after close the same button reaches nothing', async () => {
    const { kernel, zone, bar } = await running();
    const run: HTMLButtonElement = buttons(bar)[0];
    const before: number = kernel.calls.length;
    run.click();
    await until(() => kernel.calls.length === before + 1, 4000);
    await zone.close('unmount');
    expect(bar.querySelector('button')).toBeNull();
    run.click();
    await new Promise<void>((done) => setTimeout(done, 100));
    expect(kernel.calls.length).toBe(before + 1);
  });
});

describe('the toolbar’s bounds and updates', () => {
  // The label is the id unless a case names one: most cases are about ids and counts.
  const item = (id: string, label: string = id): ToolbarItem => ({ id, label, icon_name: null });

  it('refuses a toolbar out of bounds whole, keeping the one shown', () => {
    const t: ZoneToolbar = zoneToolbar(document, 'Kanban', () => undefined);
    const ui: UiPort = zoneUiPort(t);
    expect(ui.SetToolbar({ items: [item('a')] })).toEqual({ ok: null });
    const many: ToolbarItem[] = Array.from({ length: MAX_TOOLBAR_ITEMS + 1 }, (_v, i: number) => item(`b${i}`));
    expect(ui.SetToolbar({ items: many })).toEqual({ refused: { limit: 'toolbar_items' } });
    expect(ui.SetToolbar({ items: [item('a', 'x'.repeat(MAX_TOOLBAR_LABEL_CHARS + 1))] })).toEqual({ refused: { policy: 'toolbar_label' } });
    expect(ui.SetToolbar({ items: [item('a'), item('a')] })).toEqual({ refused: { policy: 'toolbar_duplicate_id' } });
    expect(ui.SetToolbar({ items: [item('a', 'line\u0007')] })).toEqual({ refused: { policy: 'toolbar_label' } });
    expect(buttons(t.element).map((b) => b.textContent)).toEqual(['a']);
    expect(readToolbar(Array.from({ length: MAX_TOOLBAR_ITEMS }, (_v, i: number) => item(`c${i}`))).ok).toBe(true);
  });

  it('an update replaces the buttons; an empty one hides the bar; a disposed bar reports nothing', () => {
    const pressed: string[] = [];
    const t: ZoneToolbar = zoneToolbar(document, 'Kanban', (id: string) => pressed.push(id));
    t.set([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    t.set([{ id: 'c', label: 'C' }]);
    expect(buttons(t.element).map((b) => b.dataset.itemId)).toEqual(['c']);
    t.set([]);
    expect([buttons(t.element).length, t.element.style.display]).toEqual([0, 'none']);
    t.set([{ id: 'd', label: 'D' }]);
    const d: HTMLButtonElement = buttons(t.element)[0];
    d.click();
    t.dispose();
    d.click();
    t.set([{ id: 'e', label: 'E' }]);
    expect([pressed, buttons(t.element).length]).toEqual([['d'], 1]);
  });
});
