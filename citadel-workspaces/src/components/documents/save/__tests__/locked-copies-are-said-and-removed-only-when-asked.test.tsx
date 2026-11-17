/**
 * A document whose copies on this device are sealed with a root the agent no longer has opens
 * from the server, and the title bar says the copies are locked: never shown as data, never
 * dropped as nothing. Discard asks first, saying edits never sent are among them, and only a
 * yes removes them; then the document is no longer locked.
 *
 * Production session, cache, seam, sealing and controls, over the kernel double and real
 * replicas. Doubles at the I/O edges only: the browser's store and the agent's root store
 * (lib/at-rest/__tests__/doubles/device-records.ts), and the toast sink.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agent, device, provideAgentDouble, resetDoubles } from '@/lib/at-rest/__tests__/doubles/device-records';

vi.mock('@/lib/storage-utils', async () => (await import('@/lib/at-rest/__tests__/doubles/device-records')).browserStore());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Copies kept by an earlier page, sealed, and then the agent's root for them gone. */
async function lockedCopies(account: bigint, nodeId: string): Promise<void> {
  await provideAgentDouble();
  const { indexedDbDocumentCache } = await import('@/lib/cdoc/collab/document-cache');
  const { memoryLocks } = await import('@/lib/cdoc/collab/__tests__/doubles/memory-device');
  const seam: typeof import('@/lib/document-replica-cache') = await import('@/lib/document-replica-cache');
  const earlier: import('@/lib/cdoc/collab/ports').DocumentCache = indexedDbDocumentCache(account, memoryLocks());
  await earlier.saveEdits(nodeId, 'tab-closed', [utf8('never sent')]);
  await seam.setDocumentsAtRest(account, true);
  agent.roots.clear();
  vi.resetModules();
  await provideAgentDouble();
}

beforeEach((): void => { resetDoubles(); });

describe('copies on this device that cannot be opened here', () => {
  it('are said to be locked, and Discard removes them only after a yes that names the unsent edits', async () => {
    const harness: typeof import('@/lib/cdoc/collab/__tests__/doubles/harness') = await import('@/lib/cdoc/collab/__tests__/doubles/harness');
    await lockedCopies(harness.ALICE, harness.NODE);
    const fresh: typeof import('@/lib/cdoc/collab/__tests__/doubles/harness') = await import('@/lib/cdoc/collab/__tests__/doubles/harness');
    const { realReplicas } = await import('@/lib/cdoc/collab/__tests__/doubles/real-replicas');
    const { indexedDbDocumentCache } = await import('@/lib/cdoc/collab/document-cache');
    const { memoryLocks } = await import('@/lib/cdoc/collab/__tests__/doubles/memory-device');
    const { saveControl } = await import('../save-control');
    const { DocumentSaveControls } = await import('../DocumentSaveControls');

    const { kernel, clock } = await fresh.newDocument({});
    const tab: ReturnType<typeof fresh.openTab> = fresh.openTab(kernel, clock, fresh.ALICE, {}, realReplicas(), indexedDbDocumentCache(fresh.ALICE, memoryLocks()));
    const control: ReturnType<typeof saveControl> = saveControl(fresh.NODE);
    control.bind(tab.session);
    await act(async (): Promise<void> => { await tab.session.open(); await kernel.settle([tab.session]); });
    const { SAVE_INDICATOR_TIMING } = await import('@/lib/document-save/save-indicator-timing');
    render(<DocumentSaveControls control={control} clock={clock} timing={SAVE_INDICATOR_TIMING} />);

    await waitFor((): void => { expect(screen.getByTestId('docs-save-status-label').textContent).toBe('Locked on this device'); });
    expect(tab.problems).toEqual([]);
    const closedTabsEdits: string = `cdoc-collab:${fresh.ALICE.toString()}:${fresh.NODE}#edits:tab-closed`;
    expect(device.records.has(closedTabsEdits)).toBe(true);

    fireEvent.click(screen.getByTestId('docs-locked-discard'));
    const question: HTMLElement = await screen.findByTestId('docs-locked-confirm');
    expect(question.textContent).toContain('Edits to it that were never sent are among them and will be lost.');
    expect(device.records.has(closedTabsEdits)).toBe(true);

    await act(async (): Promise<void> => { fireEvent.click(screen.getByTestId('docs-locked-confirm-remove')); });
    await waitFor((): void => { expect(device.records.has(closedTabsEdits)).toBe(false); });
    await waitFor((): void => { expect(screen.getByTestId('docs-save-status-label').textContent).toBe('All changes saved'); });
    expect(screen.queryByTestId('docs-locked-discard')).toBeNull();
  });
});
