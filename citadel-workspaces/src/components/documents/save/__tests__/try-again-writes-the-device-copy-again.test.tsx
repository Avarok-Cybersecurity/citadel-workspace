/**
 * When this device could not keep a copy of the edits, the title bar says so and Try again writes
 * them again: a production DocumentSession over the kernel double and real replicas, with AutoSave
 * off so the edits stay held, and one keystroke (a later edit's own write would heal the copy by
 * itself, which is the coalescing local-edits.ts does). The one double beyond the harness: the device's `saveEdits` refuses
 * once, as a full disk or a revoked storage grant would (IndexedDB cannot be made to fail on
 * demand in jsdom), and is the memory device's own write after that.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALICE, newDocument, openTab, type Tab } from '@/lib/cdoc/collab/__tests__/doubles/harness';
import { memoryDevice, type MemoryDevice } from '@/lib/cdoc/collab/__tests__/doubles/memory-device';
import { realReplicas, typeInto } from '@/lib/cdoc/collab/__tests__/doubles/real-replicas';
import type { DocumentCache } from '@/lib/cdoc/collab/ports';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { SAVE_INDICATOR_TIMING } from '@/lib/document-save/save-indicator-timing';
import { DocumentSaveControls } from '../DocumentSaveControls';
import { saveControl, type BindableSaveControl } from '../save-control';

describe('Try again', () => {
  it('writes the held edits to this device again, and the status says they are kept', async () => {
    const { kernel, clock } = await newDocument({});
    const device: MemoryDevice = memoryDevice({ load: () => Promise.resolve(null), save: () => Promise.resolve(), forget: () => Promise.resolve() });
    let refusals: number = 0;
    const cache: DocumentCache = {
      ...device.cache,
      saveEdits: (nodeId: string, instance: string, updates: readonly Uint8Array[]): Promise<void> => {
        if (updates.length > 0 && refusals === 0) {
          refusals += 1;
          return Promise.reject(new Error('QuotaExceededError'));
        }
        return device.cache.saveEdits(nodeId, instance, updates);
      },
    };
    const tab: Tab<EditorSession> = openTab(kernel, clock, ALICE, {}, realReplicas(), cache);
    const control: BindableSaveControl = saveControl('doc');
    control.bind(tab.session);
    const settle = async (): Promise<void> => { await act(async (): Promise<void> => { await kernel.settle([tab.session]); await tab.session.settled(); }); };
    await act(async (): Promise<void> => { await tab.session.open(); });
    await settle();
    render(<DocumentSaveControls control={control} clock={clock} timing={SAVE_INDICATOR_TIMING} />);
    await act(async (): Promise<void> => { await control.setAutoSave(false); await typeInto(tab.replica(), 'K'); });
    await settle();

    expect(screen.getByTestId('docs-save-status')).toHaveAttribute('data-status', 'unsavedOnDevice');
    expect([...device.edits.values()]).toEqual([]);
    fireEvent.click(screen.getByTestId('docs-save-retry'));
    await settle();

    expect(screen.getByTestId('docs-save-status')).toHaveAttribute('data-status', 'savedToDevice');
    expect(screen.queryByTestId('docs-save-retry')).toBeNull();
    expect([...device.edits.values()].map((updates: readonly Uint8Array[]): number => updates.length)).toEqual([1]);
  });
});
