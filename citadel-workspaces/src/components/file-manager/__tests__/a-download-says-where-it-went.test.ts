/**
 * A download is visible: progress, an outcome, and a way to find the file.
 *
 * Live: Download pulled the file back byte-identical into the agent's data dir
 * and the user saw nothing — no progress, no save, and the FILES list still said
 * "No downloaded files yet".
 *
 * Stubbed: sonner (the output being observed) and the history's storage (I/O).
 * `downloadVisibly` and `RevfsDownloadHistory` are the real ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import {
  RevfsDownloadHistory, withRecord, MAX_DOWNLOAD_RECORDS, REVFS_DOWNLOAD_EVENTS,
  type DownloadHistoryStorage, type RevfsDownloadRecord,
} from '@/lib/revfs/download-history';
import type { FileDetails } from '@/components/layout/sidebar/file-details';
import { eventEmitter } from '@/lib/event-emitter';

interface ToastCall { kind: string; message: string; options: Record<string, unknown> }
const calls: ToastCall[] = [];
vi.mock('sonner', () => {
  const push = (kind: string) => (message: string, options: Record<string, unknown> = {}): string => {
    calls.push({ kind, message, options });
    return 'toast-1';
  };
  return { toast: { loading: push('loading'), success: push('success'), error: push('error'), info: push('info') } };
});

const { downloadVisibly } = await import('../useFileManagerDownload');

function memoryStorage(): DownloadHistoryStorage & { rows: Map<bigint, RevfsDownloadRecord[]> } {
  const rows: Map<bigint, RevfsDownloadRecord[]> = new Map();
  return {
    rows,
    load: async (owner: bigint): Promise<RevfsDownloadRecord[]> => rows.get(owner) ?? [],
    save: async (owner: bigint, records: RevfsDownloadRecord[]): Promise<void> => { rows.set(owner, records); },
  };
}

function file(state: RevfsFileState, virtualDirectory: string = '/notes.txt'): RevfsNode {
  return {
    name: 'notes.txt', path: '/Docs/notes.txt', type: 'file', fileState: state, createdAt: 0, updatedAt: 0,
    fileMetadata: { fileId: 'f1', fileName: 'notes.txt', fileSize: 12, fileType: 'text/plain', virtualDirectory, uploadedByCid: 1n },
  };
}

let storage: ReturnType<typeof memoryStorage>;
let shown: FileDetails[];
function deps(downloadFile: (path: string) => Promise<string | undefined>): Parameters<typeof downloadVisibly>[1] {
  return {
    downloadFile, requestShare: async (): Promise<string> => { throw new Error('not a peer file'); },
    myCid: 1n, sourceCid: 2n, sourceLabel: 'Bob Brown Storage',
    history: new RevfsDownloadHistory(storage), showFile: (d: FileDetails): void => { shown.push(d); }, now: (): number => 1000,
  };
}

beforeEach(() => { calls.length = 0; storage = memoryStorage(); shown = []; });

describe('downloading a stored file', () => {
  it('shows progress, then the outcome in the same toast, naming where it went', async () => {
    await downloadVisibly(file(RevfsFileState.Remote), deps(async () => '/data/transfers/2/notes.txt'));
    expect(calls.map(c => c.kind)).toEqual(['loading', 'success']);
    expect(calls[1].options.id).toBe('toast-1');
    expect(String(calls[1].options.description)).toContain('/data/transfers/2/notes.txt');
  });

  it('offers Show, which opens the saved location', async () => {
    await downloadVisibly(file(RevfsFileState.Remote), deps(async () => '/data/transfers/2/notes.txt'));
    const action: { label: string; onClick: () => void } = calls[1].options.action as { label: string; onClick: () => void };
    expect(action.label).toBe('Show');
    action.onClick();
    expect(shown).toHaveLength(1);
    expect(shown[0].savedTo).toBe('/data/transfers/2/notes.txt');
    expect(shown[0].provenance).toBe('Downloaded from Bob Brown Storage');
  });

  it('records the pull in the history the FILES list reads, and announces it', async () => {
    const heard: unknown[] = [];
    const off: () => void = eventEmitter.on(REVFS_DOWNLOAD_EVENTS.RECORDED, (r: unknown): void => { heard.push(r); });
    await downloadVisibly(file(RevfsFileState.Remote), deps(async () => '/data/transfers/2/notes.txt'));
    off();
    const rows: RevfsDownloadRecord[] = storage.rows.get(1n) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fileName: 'notes.txt', sourceCid: 2n, savedTo: '/data/transfers/2/notes.txt' });
    expect(heard).toHaveLength(1);
  });

  it('turns the progress toast into the failure, and records nothing', async () => {
    await downloadVisibly(file(RevfsFileState.Remote), deps(async () => { throw new Error('timed out'); }));
    expect(calls.map(c => c.kind)).toEqual(['loading', 'error']);
    expect(calls[1].options.id).toBe('toast-1');
    expect(storage.rows.size).toBe(0);
  });

  it('asks the uploader for a file the peer uploaded, instead of pulling what it cannot open', async () => {
    const pull: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<string> => 'never');
    const d: Parameters<typeof downloadVisibly>[1] = deps(pull);
    const asked: RevfsNode[] = [];
    d.requestShare = async (node: RevfsNode): Promise<string> => { asked.push(node); return '/data/transfers/2/notes.txt'; };
    await downloadVisibly(file(RevfsFileState.Hosted), d);
    expect(pull).not.toHaveBeenCalled();
    expect(asked.map((n) => n.path)).toEqual(['/Docs/notes.txt']);
    expect(calls.map(c => c.kind)).toEqual(['loading', 'success']);
    expect(String(calls[1].options.description)).toContain('/data/transfers/2/notes.txt');
  });

  it('opens a Received file where it already is, without pulling it', async () => {
    const pull: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<string> => 'never');
    await downloadVisibly(file(RevfsFileState.Received, '/data/downloads/notes.txt'), deps(pull));
    expect(pull).not.toHaveBeenCalled();
    expect(shown[0].savedTo).toBe('/data/downloads/notes.txt');
  });
});

describe('the download history', () => {
  it('keeps one row per object, newest first, bounded', () => {
    const rec = (id: string, at: number): RevfsDownloadRecord => ({
      id, fileName: id, fileSize: 1, fileType: '', savedTo: '', sourceCid: null, sourceLabel: 'Server', downloadedAt: at,
    });
    let rows: RevfsDownloadRecord[] = [];
    for (let i: number = 0; i < MAX_DOWNLOAD_RECORDS + 5; i++) rows = withRecord(rows, rec(`r${i}`, i));
    expect(rows).toHaveLength(MAX_DOWNLOAD_RECORDS);
    rows = withRecord(rows, rec('r50', 999));
    expect(rows[0].id).toBe('r50');
    expect(rows.filter(r => r.id === 'r50')).toHaveLength(1);
  });

  it('keeps both of two pulls that finish together', async () => {
    const history: RevfsDownloadHistory = new RevfsDownloadHistory(storage);
    const rec = (id: string): RevfsDownloadRecord => ({
      id, fileName: id, fileSize: 1, fileType: '', savedTo: '', sourceCid: 2n, sourceLabel: 'Bob', downloadedAt: 1,
    });
    await Promise.all([history.record(1n, rec('a')), history.record(1n, rec('b'))]);
    expect((storage.rows.get(1n) ?? []).map(r => r.id).sort()).toEqual(['a', 'b']);
  });
});
