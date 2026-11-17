/**
 * Layout: paragraph indents and spacing in points, and Page Setup, whose every choice sends one
 * SetSectionProperty with exactly the patch Word's own choice means.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { EditorCommand } from '@/lib/cdoc/editor/controller';
import type { PageSetup, PageSetupPatch } from '@/lib/cdoc/editor/model-values';
import { A4_NORMAL, FakeEditor, knownCaret } from './fake-editor';
import { MAY_EDIT, renderRibbon } from './render-ribbon';

function setUp(): { editor: FakeEditor; user: UserEvent } {
  const editor: FakeEditor = new FakeEditor(knownCaret({}, {}));
  renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
  return { editor, user: userEvent.setup() };
}

async function choose(user: UserEvent, menu: string, choice: string): Promise<void> {
  await user.click(screen.getByTestId(`ribbon-page-${menu}-open`));
  await user.click(await screen.findByTestId(`ribbon-page-${menu}-${choice}`));
}

const section = (patch: PageSetupPatch): EditorCommand => ({ name: 'setSectionProperty', patch });
const HALF_INCH_HEADERS: { header: number; footer: number; gutter: number } = { header: 3600, footer: 3600, gutter: 0 };

describe('the Layout ribbon', () => {
  it('sets indents and spacing in points, as Pt100', async () => {
    const { editor, user } = setUp();
    await user.click(screen.getByTestId('docs-ribbon-tab-layout'));
    await user.type(screen.getByTestId('ribbon-layout-indent-left'), '36{Enter}');
    await user.type(screen.getByTestId('ribbon-layout-indent-right'), '-4.5{Enter}');
    await user.type(screen.getByTestId('ribbon-layout-spacing-after'), '8{Enter}');
    await user.click(screen.getByTestId('ribbon-layout-break-page'));
    await waitFor((): void => expect(editor.sent).toEqual([
      { name: 'setParagraphProperty', patch: { indent: { left: 3600 } } },
      { name: 'setParagraphProperty', patch: { indent: { right: -450 } } },
      { name: 'setParagraphProperty', patch: { spacing: { after: 800 } } },
      { name: 'insertBreak', kind: 'page' },
    ]));
  });

  it('sends Word’s margins, orientation, paper and columns as one section patch each', async () => {
    const { editor, user } = setUp();
    await user.click(screen.getByTestId('docs-ribbon-tab-layout'));
    await choose(user, 'margins', 'normal');
    await choose(user, 'margins', 'narrow');
    await choose(user, 'margins', 'moderate');
    await choose(user, 'margins', 'wide');
    await choose(user, 'orientation', 'landscape');
    await choose(user, 'orientation', 'portrait');
    await choose(user, 'size', 'letter');
    await choose(user, 'size', 'legal');
    await choose(user, 'size', 'a4');
    await choose(user, 'size', 'a5');
    await choose(user, 'columns', '1');
    await choose(user, 'columns', '3');
    await waitFor((): void => expect(editor.sent).toEqual([
      section({ margins: { top: 7200, bottom: 7200, left: 7200, right: 7200, ...HALF_INCH_HEADERS } }),
      section({ margins: { top: 3600, bottom: 3600, left: 3600, right: 3600, ...HALF_INCH_HEADERS } }),
      section({ margins: { top: 7200, bottom: 7200, left: 5400, right: 5400, ...HALF_INCH_HEADERS } }),
      section({ margins: { top: 7200, bottom: 7200, left: 14400, right: 14400, ...HALF_INCH_HEADERS } }),
      section({ orientation: 'landscape' }),
      section({ orientation: 'portrait' }),
      section({ size: { width: 61200, height: 79200, orientation: 'portrait' }, orientation: 'portrait' }),
      section({ size: { width: 61200, height: 100800, orientation: 'portrait' }, orientation: 'portrait' }),
      section({ size: { width: 59530, height: 84190, orientation: 'portrait' }, orientation: 'portrait' }),
      section({ size: { width: 41955, height: 59530, orientation: 'portrait' }, orientation: 'portrait' }),
      section({ columns: { count: 1, gap: 3600, separator: false } }),
      section({ columns: { count: 3, gap: 3600, separator: false } }),
    ]));
    expect(screen.queryByTestId('ribbon-page-columns')).toBeNull();
  });

  it('presses the section’s current setup in each menu, and keeps a landscape page landscape when its size changes', async () => {
    const landscape: PageSetup = { ...A4_NORMAL, size: { width: 84190, height: 59530, orientation: 'landscape' }, columns: { count: 2, gap: 3600, separator: false } };
    const editor: FakeEditor = new FakeEditor(knownCaret({}, {}, {}, landscape));
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('docs-ribbon-tab-layout'));
    const pressedIn = async (menu: string): Promise<string[]> => {
      await user.click(screen.getByTestId(`ribbon-page-${menu}-open`));
      await screen.findByTestId(`ribbon-page-${menu}`);
      const on: string[] = [...screen.getByTestId(`ribbon-page-${menu}`).querySelectorAll('[aria-pressed="true"]')].map((el: Element): string => el.getAttribute('data-testid') ?? '');
      await user.keyboard('{Escape}');
      await waitFor((): void => expect(screen.queryByTestId(`ribbon-page-${menu}`)).toBeNull());
      return on;
    };
    expect(await pressedIn('margins')).toEqual(['ribbon-page-margins-normal']);
    expect(await pressedIn('orientation')).toEqual(['ribbon-page-orientation-landscape']);
    expect(await pressedIn('size')).toEqual(['ribbon-page-size-a4']);
    expect(await pressedIn('columns')).toEqual(['ribbon-page-columns-2']);
    await choose(user, 'size', 'letter');
    await waitFor((): void => expect(editor.sent).toEqual([section({ size: { width: 61200, height: 79200, orientation: 'portrait' }, orientation: 'landscape' })]));
  });

  it('shows no current setup before the editor reports one, and holds Size back until it does', async () => {
    const editor: FakeEditor = new FakeEditor({ known: false });
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('docs-ribbon-tab-layout'));
    expect(screen.getByTestId('ribbon-page-size-open')).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('ribbon-page-size-open'));
    expect(screen.queryByTestId('ribbon-page-size')).toBeNull();
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('The page’s setup shows once you click or type in the document.'));
    await user.click(screen.getByTestId('ribbon-page-margins-open'));
    // Unknown is not "half pressed": the options say nothing until the section is reported.
    expect(await screen.findByTestId('ribbon-page-margins-normal')).not.toHaveAttribute('aria-pressed');
    await user.click(screen.getByTestId('ribbon-page-margins-narrow'));
    await waitFor((): void => expect(editor.sent).toEqual([section({ margins: { top: 3600, bottom: 3600, left: 3600, right: 3600, ...HALF_INCH_HEADERS } })]));
  });

  it('opens a menu and chooses from it by keyboard alone, then gives focus back to the document', async () => {
    const { editor, user } = setUp();
    await user.click(screen.getByTestId('docs-ribbon-tab-layout'));
    screen.getByTestId('ribbon-page-columns-open').focus();
    await user.keyboard('{Enter}');
    await waitFor((): void => expect(screen.getByTestId('ribbon-page-columns-1')).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor((): void => expect(editor.sent).toEqual([section({ columns: { count: 2, gap: 3600, separator: false } })]));
    expect(editor.focused).toBeGreaterThan(0);
  });

  it('says why when the engine refuses a page setup', async () => {
    const { editor, user } = setUp();
    await user.click(screen.getByTestId('docs-ribbon-tab-layout'));
    editor.refuseNext('the margins leave no room for text');
    await choose(user, 'margins', 'wide');
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('Could not set the margins to Wide. the margins leave no room for text'));
  });

  it('opens no page-setup menu in a read-only document', async () => {
    const editor: FakeEditor = new FakeEditor(knownCaret({}, {}));
    renderRibbon({ editor, edit: { enabled: false, reason: 'You can only read this document.' }, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('docs-ribbon-tab-layout'));
    const margins: HTMLElement = screen.getByTestId('ribbon-page-margins-open');
    expect(margins).toHaveAttribute('aria-disabled', 'true');
    await user.click(margins);
    expect(screen.queryByTestId('ribbon-page-margins')).toBeNull();
    expect(editor.sent).toEqual([]);
  });
});
