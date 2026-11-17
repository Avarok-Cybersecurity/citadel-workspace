/**
 * The FILES list shows a file pulled out of RE-VFS storage.
 *
 * It listed completed incoming P2P transfers only, so a pull that had landed in
 * the agent's data dir left it saying "No downloaded files yet".
 *
 * Stubbed at I/O boundaries only: the IndexedDB helpers (an in-memory map),
 * which session this tab is, and the peer list's network fetch. The history,
 * the section, its event subscription and the mapping are the real ones.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const kv: Map<string, unknown> = new Map();
vi.mock('@/lib/storage-utils', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  dbGet: async (_store: string, key: string): Promise<unknown> => kv.get(key),
  dbPut: async (_store: string, key: string, value: unknown): Promise<void> => { kv.set(key, value); },
}));
vi.mock('@/lib/p2p/current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => 7n }));
// One stable answer, as the real hook gives between fetches: a fresh [] per
// render re-creates the section's loader every render.
const noPeers: { registeredPeers: never[]; isLoading: boolean } = { registeredPeers: [], isLoading: false };
vi.mock('@/hooks/use-registered-peers', () => ({ useRegisteredPeers: (): typeof noPeers => noPeers }));
vi.mock('@/components/shared/confirm-dialog', () => ({ useConfirm: () => async (): Promise<boolean> => true }));
vi.mock('@/components/ui/sidebar', () => {
  const Pass = ({ children }: { children?: ReactNode }): JSX.Element => <div>{children}</div>;
  const Button = ({ children, onClick }: { children?: ReactNode; onClick?: () => void }): JSX.Element =>
    <button onClick={onClick}>{children}</button>;
  return { SidebarGroup: Pass, SidebarGroupContent: Pass, SidebarGroupLabel: Pass, SidebarMenu: Pass, SidebarMenuItem: Pass, SidebarMenuButton: Button };
});

const { FilesSection } = await import('../FilesSection');
const { revfsDownloadHistory } = await import('@/lib/revfs/download-history');

describe('the sidebar FILES list', () => {
  it('lists a RE-VFS download as soon as it is recorded', async () => {
    render(<MemoryRouter><FilesSection /></MemoryRouter>);
    expect(await screen.findByTestId('no-files-message')).toBeInTheDocument();

    await act(async (): Promise<void> => {
      await revfsDownloadHistory.record(7n, {
        id: 'revfs:f1', fileName: 'notes.txt', fileSize: 12, fileType: 'text/plain',
        savedTo: '/data/transfers/2/notes.txt', sourceCid: 2n, sourceLabel: 'Bob Brown Storage', downloadedAt: 1,
      });
    });

    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    expect(screen.queryByTestId('no-files-message')).toBeNull();
  });
});
