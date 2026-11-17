/**
 * A file shared in a node channel shows as a card: the picture itself only when its bytes are a
 * raster image within the decode limits (never by its name or declared type), and a Download that
 * saves the original bytes under the sender's name with any path taken off.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ServerFileCard } from '../ServerFileCard';
import { AttachmentIOContext, type AttachmentIO } from '../attachment-io';
import type { SavedFile } from '@/lib/document-files';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';

/** A PNG's signature and an IHDR declaring 2 x 3 pixels: what the header check reads. */
const PNG: Uint8Array = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0,
]);
const SVG: Uint8Array = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function io(bytes: Uint8Array): AttachmentIO & { saved: SavedFile[] } {
  const saved: SavedFile[] = [];
  return { saved, read: async (): Promise<Uint8Array> => bytes, files: { save: (file: SavedFile): void => { saved.push(file); } } };
}

function card(file: SharedFile, value: AttachmentIO | null): void {
  render(<AttachmentIOContext.Provider value={value}><ServerFileCard file={file} /></AttachmentIOContext.Provider>);
}

const picture: SharedFile = { id: 'a'.repeat(64), name: '../../photos/holiday.png', size: PNG.length, mime: 'image/png' };

describe('a shared file in a node channel', () => {
  beforeEach((): void => { URL.createObjectURL = vi.fn((): string => 'blob:picture'); URL.revokeObjectURL = vi.fn(); });
  afterEach((): void => { vi.restoreAllMocks(); });

  it('shows a picture whose bytes are one', async () => {
    card(picture, io(PNG));
    expect(await screen.findByTestId('server-file-picture')).toHaveAttribute('src', 'blob:picture');
  });

  it('does not draw an SVG that calls itself a PNG', async () => {
    const reads: Mock<() => Promise<Uint8Array>> = vi.fn(async (): Promise<Uint8Array> => SVG);
    card({ ...picture, size: SVG.length }, { read: reads, files: { save: vi.fn() } });
    await waitFor((): void => expect(reads).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByTestId('server-file-picture')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('downloads the original bytes under the sender\'s name without its path', async () => {
    const value: AttachmentIO & { saved: SavedFile[]; } = io(PNG);
    card(picture, value);
    fireEvent.click(screen.getByRole('button', { name: 'Download ../../photos/holiday.png' }));
    await waitFor((): void => expect(value.saved).toHaveLength(1));
    expect(value.saved[0]).toEqual({ bytes: PNG, mime: 'image/png', name: 'holiday.png' });
  });

  it('says why a download failed', async () => {
    card(picture, { read: async (): Promise<Uint8Array> => { throw new Error('You cannot share or open files in this channel.'); }, files: { save: vi.fn() } });
    fireEvent.click(screen.getByTestId('server-file-download'));
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot share or open files in this channel.');
  });

  it('offers no download where the conversation cannot read files', () => {
    card(picture, null);
    expect(screen.getByText('../../photos/holiday.png')).toBeInTheDocument();
    expect(screen.queryByTestId('server-file-download')).toBeNull();
  });
});
