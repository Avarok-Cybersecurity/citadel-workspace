/**
 * The first file offer a person has to answer by hand asks "Always accept files from {peer}?"
 * (AlwaysAcceptDialog), once per peer, as the offer arrives. It is modal: until it is answered
 * the offer's own Accept button sits under its overlay, so a spec that accepts by hand answers
 * it first.
 *
 * "Ask me each time" keeps every later offer a manual Accept, which is what the specs calling
 * this measure; "always" would accept this offer and every later one without a click.
 */
import type { Locator, Page } from 'playwright';
import { isVisibleWithin } from './utils.js';

/** Pages that have answered: the question is never asked twice, so a second wait would only stall. */
const answered: WeakSet<Page> = new WeakSet<Page>();

/**
 * What lies over a control a click could not reach: every open dialog, and the stack of elements
 * at the control's centre. CI once reported only "an aria-hidden bg-black/80 overlay intercepts
 * pointer events" here, which names no dialog; this names the layer that covers the answer.
 */
async function whatCovers(page: Page, control: Locator): Promise<string> {
  const box: { x: number; y: number; width: number; height: number } | null = await control.boundingBox();
  if (box === null) return 'the control has no box';
  // One anonymous callback: a named function inside evaluate is wrapped by esbuild (tsx) in a
  // __name helper the page does not have.
  return page.evaluate(({ x, y }: { x: number; y: number }): string => {
    const groups: Element[][] = [
      Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')),
      document.elementsFromPoint(x, y).slice(0, 6),
      Array.from(document.body.children).slice(1),
    ];
    const [dialogs, stack, layers]: string[][] = groups.map((group: Element[]): string[] => group.map((el: Element): string => {
      const testid: string | null = el.getAttribute('data-testid');
      const role: string | null = el.getAttribute('role');
      const title: string = el.querySelector('h2')?.textContent?.trim() ?? '';
      return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}${testid ? ` testid=${testid}` : ''}`
        + ` state=${el.getAttribute('data-state') ?? '-'} hidden=${el.getAttribute('aria-hidden') ?? '-'}`
        + ` pe=${getComputedStyle(el).pointerEvents}${title ? ` title="${title}"` : ''}>`;
    }));
    return `open dialogs (${dialogs.length}): ${dialogs.join(' ')}\nat the control (${x},${y}): ${stack.join(' > ')}`
      + `\nbody-level layers after the app root: ${layers.join(' ')}`;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/**
 * Answer the question with "Ask me each time" if this page has not yet, and say whether it was
 * asked. `withinMs` bounds the wait for the dialog after the offer is already on screen: both
 * come from the same arrival.
 */
export async function keepAskingEachTime(page: Page, withinMs: number): Promise<boolean> {
  if (answered.has(page)) return false;
  const dialog: Locator = page.getByTestId('always-accept-dialog');
  if (!(await isVisibleWithin(dialog, withinMs))) return false;
  const no: Locator = dialog.getByTestId('always-accept-no');
  try {
    await no.click();
  } catch (error: unknown) {
    const covers: string = await whatCovers(page, no).catch((e: unknown) => `could not inspect: ${String(e)}`);
    throw new Error(`"Ask me each time" could not be clicked.\n${covers}`, { cause: error });
  }
  await dialog.waitFor({ state: 'detached', timeout: 10000 });
  answered.add(page);
  return true;
}
