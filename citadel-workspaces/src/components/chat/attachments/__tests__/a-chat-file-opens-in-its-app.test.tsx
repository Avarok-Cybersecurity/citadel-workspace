/**
 * A file shown in a chat opens in the app registered for its extension, from a menu reachable
 * without a mouse: a 44 px "more" button (keyboard and touch) and the card's right-click open the
 * same menu. It offers "Open in <app>" with the app's icon only when an app opens the file, and
 * Download always; opening shows the file in a dialog over the conversation.
 *
 * Real: the card, its hooks, the opener lookup. The one double is the conversation's attachment
 * I/O (the server read and the browser save), as in a-shared-file-shows-and-downloads.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ServerFileCard } from '../ServerFileCard';
import { AttachmentIOContext, type AttachmentIO } from '../attachment-io';
import type { SavedFile } from '@/lib/document-files';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';

const BYTES: Uint8Array = new TextEncoder().encode('# Plan\n');

function io(): AttachmentIO & { saved: SavedFile[]; reads: number } {
  const value: AttachmentIO & { saved: SavedFile[]; reads: number } = {
    saved: [], reads: 0,
    read: async (): Promise<Uint8Array> => { value.reads++; return BYTES; },
    files: { save: (file: SavedFile): void => { value.saved.push(file); } },
    where: 'on the workspace server',
  };
  return value;
}

const shared = (name: string, mime: string): SharedFile => ({ id: 'b'.repeat(64), name, size: BYTES.length, mime });

function card(file: SharedFile, value: AttachmentIO | null): void {
  render(<AttachmentIOContext.Provider value={value}><ServerFileCard file={file} /></AttachmentIOContext.Provider>);
}

/** Opens the menu from the keyboard, the way a person without a mouse reaches it. */
function openByKeyboard(): string[] {
  fireEvent.keyDown(screen.getByTestId('chat-file-menu'), { key: 'Enter' });
  return screen.getAllByRole('menuitem').map((i: HTMLElement) => i.textContent ?? '');
}

describe('a chat file\'s menu', () => {
  it('is behind a 44 px button named for the file', () => {
    card(shared('plan.md', 'text/markdown'), io());
    const more: HTMLElement = screen.getByRole('button', { name: 'Actions for plan.md' });
    expect(more.className).toContain('h-[44px]');
    expect(more.className).toContain('w-[44px]');
    expect(more.className).not.toMatch(/opacity-0|group-hover/);
  });

  it('offers Open in Citadel Docs, with its icon, and Download for a file Docs opens', () => {
    card(shared('plan.md', 'text/markdown'), io());
    expect(openByKeyboard()).toEqual(['Open in Citadel Docs', 'Download']);
    expect(screen.getByTestId('chat-file-open-in-app').querySelector('svg.lucide-file-text')).not.toBeNull();
    expect(screen.queryByTestId('chat-file-open-with')).toBeNull();
  });

  it('offers only Download for a file no app opens', () => {
    card(shared('archive.zip', 'application/zip'), io());
    expect(openByKeyboard()).toEqual(['Download']);
  });

  it('opens from a right-click on the card too', () => {
    card(shared('plan.docx', ''), io());
    fireEvent.contextMenu(screen.getByTestId('server-file'));
    expect(screen.getByRole('menuitem', { name: 'Open in Citadel Docs' })).toBeInTheDocument();
  });

  it('downloads the original from the menu', async () => {
    const value: AttachmentIO & { saved: SavedFile[]; reads: number } = io();
    card(shared('plan.md', 'text/markdown'), value);
    openByKeyboard();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
    await waitFor((): void => expect(value.saved.map((f: SavedFile): string => f.name)).toEqual(['plan.md']));
  });

  it('opens the file in Docs in a dialog over the conversation, reading its bytes', async () => {
    const value: AttachmentIO & { saved: SavedFile[]; reads: number } = io();
    card(shared('plan.md', 'text/markdown'), value);
    openByKeyboard();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Citadel Docs' }));
    const dialog: HTMLElement = await screen.findByTestId('chat-file-opened');
    expect(dialog).toHaveAttribute('data-app', 'docs');
    expect(screen.getByRole('dialog', { name: 'plan.md' })).toBe(dialog);
    await waitFor((): void => expect(value.reads).toBeGreaterThan(0));
    // The card is still there behind it: nothing navigated away.
    expect(screen.getByTestId('server-file')).toBeInTheDocument();
  });

  it('has no Open where the conversation cannot read the file', () => {
    card(shared('plan.md', 'text/markdown'), null);
    expect(screen.queryByTestId('chat-file-menu')).toBeNull();
  });
});

vi.mock('@/lib/cdoc/runtime-loader', () => ({
  // The Docs engine runs in a worker the test DOM has none of; the dialog is under test, not the engine
  // (a-docs-file-opens-in-citadel-docs runs the real engine over the same DocsFileView).
  loadCdocRuntime: (): Promise<never> => new Promise<never>((): void => undefined),
}));
