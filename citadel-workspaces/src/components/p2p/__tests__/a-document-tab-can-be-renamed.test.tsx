import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ChatTabBar, MESSAGES_TAB, createLiveDocumentTab, type ChatTab } from '../ChatTabBar';

/** Real tab bar, context menu and dialog; the only fake is the rename callback (the store seam). */
const tabs: ChatTab[] = [MESSAGES_TAB, createLiveDocumentTab('doc-1', 'Draft')];

/** `renamable` defaults to true: every case but one is a direct chat's document, which renames. */
function setup(onTabRename: (id: string, title: string) => Promise<void>, renamable: boolean = true): void {
  render(<ChatTabBar tabs={tabs} activeTabId="messages" onTabSelect={vi.fn()} onTabClose={vi.fn()} onTabRename={onTabRename} renamable={(): boolean => renamable} />);
}
const docTab = (): HTMLElement => screen.getByRole('button', { name: /^Draft$/ });

afterEach(cleanup);

describe('renaming from the tab', () => {
  it('right-click, Rename, type, confirm: sends the trimmed title for that document', async () => {
    const rename: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
    setup(rename);
    fireEvent.contextMenu(docTab());
    fireEvent.click(await screen.findByTestId('tab-rename'));
    const input: HTMLInputElement = await screen.findByTestId('rename-document-input') as HTMLInputElement;
    expect(input.value).toBe('Draft');
    fireEvent.change(input, { target: { value: '  Launch plan  ' } });
    fireEvent.click(screen.getByTestId('rename-document-confirm'));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('doc-1', 'Launch plan'));
    await waitFor(() => expect(screen.queryByTestId('rename-document-dialog')).toBeNull());
  });

  it('offers no rename for a document whose rename nothing carries', () => {
    setup(vi.fn(), false);
    fireEvent.keyDown(docTab(), { key: 'F2' });
    fireEvent.contextMenu(docTab());
    expect(screen.queryByTestId('rename-document-dialog')).toBeNull();
    expect(screen.queryByTestId('tab-rename')).toBeNull();
  });

  it('F2 on a document tab opens the same dialog', async () => {
    setup(vi.fn());
    fireEvent.keyDown(docTab(), { key: 'F2' });
    expect(await screen.findByTestId('rename-document-dialog')).toBeInTheDocument();
  });

  it('refuses a blank title with a reason and does not call rename', async () => {
    const rename: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
    setup(rename);
    fireEvent.keyDown(docTab(), { key: 'F2' });
    fireEvent.change(await screen.findByTestId('rename-document-input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('rename-document-confirm'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/enter a title/i);
    expect(rename).not.toHaveBeenCalled();
  });

  it('refuses a title over the limit', async () => {
    const rename: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
    setup(rename);
    fireEvent.keyDown(docTab(), { key: 'F2' });
    fireEvent.change(await screen.findByTestId('rename-document-input'), { target: { value: 'x'.repeat(81) } });
    fireEvent.click(screen.getByTestId('rename-document-confirm'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/80 characters/);
    expect(rename).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and says why when the rename itself fails', async () => {
    setup(vi.fn(async () => { throw new Error('This document is not saved on this device.'); }));
    fireEvent.keyDown(docTab(), { key: 'F2' });
    fireEvent.change(await screen.findByTestId('rename-document-input'), { target: { value: 'New' } });
    fireEvent.click(screen.getByTestId('rename-document-confirm'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not saved/);
    expect(screen.getByTestId('rename-document-dialog')).toBeInTheDocument();
  });

  it('offers no rename on the Messages tab', () => {
    setup(vi.fn());
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Messages$/ }));
    expect(screen.queryByTestId('tab-rename')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Messages$/ }), { key: 'F2' });
    expect(screen.queryByTestId('rename-document-dialog')).toBeNull();
  });

  it('returns focus to the tab it was opened from, and announces the result', async () => {
    setup(vi.fn(async () => undefined));
    const tab: HTMLElement = docTab();
    tab.focus();
    fireEvent.keyDown(tab, { key: 'F2' });
    fireEvent.change(await screen.findByTestId('rename-document-input'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('rename-document-confirm'));
    await waitFor(() => expect(screen.queryByTestId('rename-document-dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(tab));
    expect(screen.getByRole('status').textContent).toBe('Document renamed to Renamed');
  });
});
