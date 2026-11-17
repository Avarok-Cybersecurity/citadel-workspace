/**
 * The title bar's save controls: the switch turns AutoSave off and on for this device, Save
 * and Ctrl/Cmd+S over the document send the held edits, the status says where they are, and
 * closing the page warns only while edits are not yet written to the device. The production
 * control bound to a production DocumentSession over the kernel double and real replicas.
 */
import { act, fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALICE, newDocument, openTab, type Tab } from '@/lib/cdoc/collab/__tests__/doubles/harness';
import { memoryDevice, type MemoryDevice } from '@/lib/cdoc/collab/__tests__/doubles/memory-device';
import { realReplicas, typeInto } from '@/lib/cdoc/collab/__tests__/doubles/real-replicas';
import type { ScriptedKernel } from '@/lib/cdoc/collab/__tests__/doubles/scripted-kernel';
import type { SaveInputs } from '@/lib/document-save/save-status';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { DocumentSaveControls, saveShortcut } from '../DocumentSaveControls';
import { saveControl, type BindableSaveControl } from '../save-control';
import { SAVE_INDICATOR_TIMING } from '@/lib/document-save/save-indicator-timing';
import { ManualClock } from '@/lib/cdoc/collab/__tests__/doubles/manual-clock';

interface Open {
  readonly kernel: ScriptedKernel;
  readonly tab: Tab<EditorSession>;
  readonly control: BindableSaveControl;
  readonly settle: () => Promise<void>;
  readonly clock: ManualClock;
}

async function openDocument(): Promise<Open> {
  const { kernel, clock } = await newDocument({});
  const device: MemoryDevice = memoryDevice({ load: () => Promise.resolve(null), save: () => Promise.resolve(), forget: () => Promise.resolve() });
  const tab: Tab<EditorSession> = openTab(kernel, clock, ALICE, {}, realReplicas(), device.cache);
  const control: BindableSaveControl = saveControl('doc');
  control.bind(tab.session);
  await tab.session.open();
  const settle = async (): Promise<void> => { await act(async (): Promise<void> => { await kernel.settle([tab.session]); }); };
  await settle();
  return { kernel, tab, control, settle, clock };
}

const appends = (kernel: ScriptedKernel): number => kernel.sentOf('Append').length;
const statusText = (): string => screen.getByTestId('docs-save-status-label').textContent ?? '';

describe('the save controls', () => {
  it('say Saved with AutoSave on, and keep edits on the device once it is switched off', async () => {
    const { kernel, tab, control, settle, clock } = await openDocument();
    render(<DocumentSaveControls control={control} clock={clock} timing={SAVE_INDICATOR_TIMING} />);
    expect(statusText()).toBe('All changes saved');
    expect(screen.getByTestId('docs-autosave').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId<HTMLButtonElement>('docs-save').disabled).toBe(true);

    fireEvent.click(screen.getByTestId('docs-autosave'));
    await settle();
    expect(screen.getByTestId('docs-autosave').getAttribute('aria-checked')).toBe('false');
    await act(async (): Promise<void> => { await typeInto(tab.replica(), 'Kq7'); });
    await settle();
    expect(appends(kernel)).toBe(0);
    expect(statusText()).toBe('Saved to this device');

    fireEvent.click(screen.getByTestId('docs-save'));
    await settle();
    expect(appends(kernel)).toBe(3);
    expect(statusText()).toBe('All changes saved');
  });

  it('save on Ctrl/Cmd+S over the document, and keep the browser from saving the page', async () => {
    const { kernel, tab, control, settle } = await openDocument();
    await act(async (): Promise<void> => { await control.setAutoSave(false); await typeInto(tab.replica(), 'Kq'); });
    await settle();
    const view: RenderResult = render(<section data-testid="region" onKeyDownCapture={saveShortcut(control)}><input data-testid="inside" /></section>);
    const plain: boolean = fireEvent.keyDown(screen.getByTestId('inside'), { key: 's' });
    expect(plain).toBe(true);
    expect(appends(kernel)).toBe(0);
    const saved: boolean = fireEvent.keyDown(screen.getByTestId('inside'), { key: 's', metaKey: true });
    await settle();
    expect(saved).toBe(false);
    expect(appends(kernel)).toBe(2);
    view.unmount();
  });

  it('warn on closing only while edits are not yet written to this device', () => {
    const control: BindableSaveControl = saveControl('doc');
    const held = (local: SaveInputs['local']): SaveInputs => ({ autoSave: false, link: 'up', unacknowledged: 1, syncRequested: false, local, halted: false, locked: false });
    render(<DocumentSaveControls control={control} clock={new ManualClock()} timing={SAVE_INDICATOR_TIMING} />);
    const closing = (): boolean => window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    act((): void => control.inputs.set(held('writing')));
    // A write to this device in flight is a save under way: it changes nothing on screen, but closing warns.
    expect(statusText()).toBe('All changes saved');
    expect(closing()).toBe(false);
    act((): void => control.inputs.set(held('written')));
    expect(statusText()).toBe('Saved to this device');
    expect(closing()).toBe(true);
  });

  it('show nothing until the document is open', () => {
    render(<DocumentSaveControls control={saveControl('doc')} clock={new ManualClock()} timing={SAVE_INDICATOR_TIMING} />);
    expect(screen.queryByTestId('docs-save-controls')).toBeNull();
  });
});
