/**
 * The ribbon against the real engine, no doubles: DocumentHost over the in-process cdoc runtime
 * opens an EditorSession, DocsCanvas provides it, and ribbon commands change the document the
 * engine lays out. The FakeEditor suites pin each control's exact command; this one proves the
 * commands land.
 */
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { inProcessRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import { DocumentHost, type DocumentHostProps } from '../../DocumentHost';
import { recordingDocumentFiles } from '@/test-utils/recording-document-files';
import { keepBlankReplica } from '../../blank-replica';
import type { DocumentEditing } from '../../use-docs-document';

// A document nobody shares: the commands, not the collaboration, are under test here.
const EDIT_BLANK: DocumentEditing = { kind: 'replica', keep: keepBlankReplica, save: null, pictures: null };

const BLANK: DocumentHostProps = {
  nodeId: 'plan-1',
  appId: 'docs',
  title: 'Quarterly plan',
  permissions: { edit: { enabled: true, reason: null } },
  documentSource: { kind: 'blank' },
  loadCdocRuntime: (): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread')),
  // Any signed-in name: this is about commands reaching the engine, not who signs.
  commentAuthor: 'Ada',
  // Any fixed instant: nothing is downloaded here.
  files: recordingDocumentFiles('2026-10-18T00:00:00Z'),
  original: null,
  editing: EDIT_BLANK,
};

describe('the ribbon over the real editor', () => {
  it('appears once the editor opens, and a page break from Insert adds a page; Undo takes it back', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    const bar: HTMLElement = screen.getByTestId('document-status-bar');
    await within(bar).findByText('Page 1 of 1', {}, { timeout: 10_000 });
    await user.click(await screen.findByTestId('docs-ribbon-tab-insert', {}, { timeout: 10_000 }));
    await user.click(screen.getByTestId('ribbon-insert-break-page'));
    await waitFor((): void => expect(within(bar).getByText('Page 1 of 2')).toBeInTheDocument(), { timeout: 10_000 });
    await user.click(screen.getByTestId('docs-ribbon-tab-home'));
    await user.click(screen.getByTestId('ribbon-undo'));
    await waitFor((): void => expect(within(bar).getByText('Page 1 of 1')).toBeInTheDocument(), { timeout: 10_000 });
  }, 30_000);

  it('shows what the engine refuses: removing a link where there is none', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    await user.click(await screen.findByTestId('docs-ribbon-tab-insert', {}, { timeout: 10_000 }));
    await user.click(screen.getByTestId('ribbon-remove-link'));
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(/^Could not remove the link\. .+/), { timeout: 10_000 });
  }, 30_000);

  it('reads the caret from the engine: Bold turns pressed, and the size grows from the style’s own', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    const bold: HTMLElement = await screen.findByTestId('ribbon-mark-bold', {}, { timeout: 10_000 });
    expect(bold).toHaveAttribute('aria-pressed', 'mixed');
    await user.click(bold);
    await waitFor((): void => expect(bold).toHaveAttribute('aria-pressed', 'true'), { timeout: 10_000 });
    const size: HTMLElement = screen.getByTestId('ribbon-font-size');
    const before: string = (size as HTMLSelectElement).value;
    expect(before).not.toBe('');
    await user.click(screen.getByTestId('ribbon-grow-font'));
    await waitFor((): void => expect(Number((size as HTMLSelectElement).value)).toBeGreaterThan(Number(before)), { timeout: 10_000 });
    expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(/^$/);
  }, 30_000);

  it('takes a page setup, and the section the engine reports back shows it: landscape, Narrow margins', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    await user.click(await screen.findByTestId('docs-ribbon-tab-layout', {}, { timeout: 10_000 }));
    await user.click(screen.getByTestId('ribbon-page-orientation-open'));
    await user.click(await screen.findByTestId('ribbon-page-orientation-landscape'));
    await user.click(screen.getByTestId('ribbon-page-margins-open'));
    await user.click(await screen.findByTestId('ribbon-page-margins-narrow'));
    await waitFor((): void => expect(screen.getByTestId('editor-input')).toHaveFocus(), { timeout: 10_000 });
    await user.click(screen.getByTestId('ribbon-page-margins-open'));
    await waitFor((): void => expect(screen.getByTestId('ribbon-page-margins-narrow')).toHaveAttribute('aria-pressed', 'true'), { timeout: 10_000 });
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('ribbon-page-orientation-open'));
    expect(await screen.findByTestId('ribbon-page-orientation-landscape')).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    // A blank document is A4 as the engine sizes it, and the Size menu names it so.
    await user.click(screen.getByTestId('ribbon-page-size-open'));
    expect(await screen.findByTestId('ribbon-page-size-a4')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(/^$/);
  }, 30_000);

  it('offers the engine’s own styles, and takes a bulleted list and a footnote', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    await user.click(await screen.findByTestId('ribbon-styles-open', {}, { timeout: 10_000 }));
    expect(await screen.findByTestId('ribbon-style-Heading1', {}, { timeout: 10_000 })).toHaveTextContent('Heading 1');
    await user.keyboard('{Escape}');
    // A first result makes the caret's paragraph known: outside a list, so No list is refused.
    await user.click(screen.getByTestId('ribbon-mark-bold'));
    await waitFor((): void => expect(screen.getByTestId('ribbon-list-none')).toHaveAttribute('aria-disabled', 'true'), { timeout: 10_000 });
    await user.click(screen.getByTestId('ribbon-bullets'));
    // The engine reports the paragraph in a list now, so it can be ended.
    await waitFor((): void => expect(screen.getByTestId('ribbon-list-none')).toHaveAttribute('aria-disabled', 'false'), { timeout: 10_000 });
    await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
    await user.click(screen.getByTestId('ribbon-insert-footnote'));
    await waitFor((): void => expect(screen.getByTestId('editor-input')).toHaveFocus(), { timeout: 10_000 });
    await act(async (): Promise<void> => { await new Promise((r: (v: unknown) => void): void => { setTimeout(r, 200); }); });
    expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(/^$/);
  }, 30_000);

  it('pastes the clipboard’s text into the document and copies it back out', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    // The system clipboard is the browser's: jsdom has none and user-event installs a stub at
    // setup, so the page is given this one after it.
    let clipboard: string = 'Hello from the clipboard';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: (): Promise<string> => Promise.resolve(clipboard), writeText: (t: string): Promise<void> => { clipboard = t; return Promise.resolve(); } },
    });
    try {
      await user.click(await screen.findByTestId('ribbon-paste', {}, { timeout: 10_000 }));
      await waitFor((): void => expect(screen.getByTestId('editor-input')).toHaveFocus(), { timeout: 10_000 });
      clipboard = '';
      await user.keyboard('{Control>}a{/Control}');
      await waitFor((): void => expect(screen.getByTestId('ribbon-copy')).toHaveAttribute('aria-disabled', 'false'), { timeout: 10_000 });
      await user.click(screen.getByTestId('ribbon-copy'));
      await waitFor((): void => expect(clipboard).toBe('Hello from the clipboard'), { timeout: 10_000 });
      // Focus going back to the real editor moves nothing, so the confirmation is not cleared unread.
      await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(/^Copied\.$/), { timeout: 10_000 });
      await act(async (): Promise<void> => { await new Promise((r: (v: unknown) => void): void => { setTimeout(r, 300); }); });
      expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(/^Copied\.$/);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  }, 30_000);

  it('enters the header from Insert, says so, and Back returns to the document', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    await user.click(await screen.findByTestId('docs-ribbon-tab-insert', {}, { timeout: 10_000 }));
    await user.click(screen.getByTestId('ribbon-edit-header-open'));
    await user.click(await screen.findByTestId('ribbon-edit-header-default'));
    const bar: HTMLElement = await screen.findByTestId('docs-story-bar', {}, { timeout: 10_000 });
    expect(bar).toHaveTextContent(/^Editing the header of section 1\./);
    expect(screen.getByTestId('ribbon-edit-header-open')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('docs-story-back'));
    await waitFor((): void => expect(screen.queryByTestId('docs-story-bar')).toBeNull(), { timeout: 10_000 });
  }, 30_000);

  it('says why the engine refuses a first-page footer in a section without a distinct first page', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    await user.click(await screen.findByTestId('docs-ribbon-tab-insert', {}, { timeout: 10_000 }));
    await user.click(screen.getByTestId('ribbon-edit-footer-open'));
    await user.click(await screen.findByTestId('ribbon-edit-footer-firstPage'));
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(/^Could not edit the first page footer\. .+/), { timeout: 10_000 });
    expect(screen.queryByTestId('docs-story-bar')).toBeNull();
  }, 30_000);

  it('puts the caret in a new footnote, whose bar leads back', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    await user.click(await screen.findByTestId('docs-ribbon-tab-insert', {}, { timeout: 10_000 }));
    await user.click(screen.getByTestId('ribbon-insert-footnote'));
    expect(await screen.findByTestId('docs-story-bar', {}, { timeout: 10_000 })).toHaveTextContent('Editing a footnote.');
    await user.click(screen.getByTestId('docs-story-back'));
    await waitFor((): void => expect(screen.queryByTestId('docs-story-bar')).toBeNull(), { timeout: 10_000 });
  }, 30_000);

  it('reads the list from the engine: Bullets turns pressed, No list ends it', async () => {
    render(<DocumentHost {...BLANK} />);
    const user: UserEvent = userEvent.setup();
    const bullets: HTMLElement = await screen.findByTestId('ribbon-bullets', {}, { timeout: 10_000 });
    await waitFor((): void => expect(bullets).toHaveAttribute('aria-pressed', 'false'), { timeout: 10_000 });
    await user.click(bullets);
    await waitFor((): void => expect(bullets).toHaveAttribute('aria-pressed', 'true'), { timeout: 10_000 });
    await user.click(screen.getByTestId('ribbon-list-none'));
    await waitFor((): void => expect(bullets).toHaveAttribute('aria-pressed', 'false'), { timeout: 10_000 });
  }, 30_000);
});
