/**
 * What the agent said about its native file picker, and the browser-upload path that
 * stands in when it has none.
 *
 * The UI hides "Browse Files" when the agent's greeting (`ServiceConnectionAccepted`)
 * says `native_picker: false`, and offers it when the field is absent (older agents) or
 * true. The Docker agent is headless and truthfully says false, so a spec must follow
 * what the agent reports, which it reads off the socket as the page received it: the
 * page exposes no store for it.
 */
import type { Locator, Page, WebSocket } from 'playwright';
import { isVisibleWithin, sleep } from './utils.js';
import { keepAskingEachTime } from './always-accept.js';

/** 'unseen' means no greeting arrived on any socket of this page; nothing may be assumed then. */
export type AgentPicker = 'true' | 'false' | 'absent' | 'unseen';

export interface PickerFrames {
  /** The latest greeting's value: a reconnect greets again, and the last one is what the page acts on. */
  agentPicker: () => AgentPicker;
  /** Frames the page sent that carry a PickFile request. */
  pickFileSent: () => number;
}

function frameText(payload: string | Buffer): string {
  return typeof payload === 'string' ? payload : payload.toString('utf8');
}

/** Install before the page first loads, or the greeting is missed. */
export function watchPickerFrames(page: Page): PickerFrames {
  let picker: AgentPicker = 'unseen';
  let pickFiles: number = 0;
  page.on('websocket', (ws: WebSocket): void => {
    ws.on('framereceived', ({ payload }: { payload: string | Buffer }): void => {
      const raw: string = frameText(payload);
      if (!raw.includes('"ServiceConnectionAccepted"')) return;
      const said: RegExpExecArray | null = /"native_picker"\s*:\s*(true|false)/.exec(raw);
      picker = said ? (said[1] as 'true' | 'false') : 'absent';
    });
    ws.on('framesent', ({ payload }: { payload: string | Buffer }): void => {
      if (frameText(payload).includes('"PickFile"')) pickFiles += 1;
    });
  });
  return { agentPicker: (): AgentPicker => picker, pickFileSent: (): number => pickFiles };
}

/**
 * The native picker's button, by the icon and by the text; a match on either is the button.
 * Inside the send dialog: the chat header's Files button carries the same folder icon, so
 * a page-wide icon match counted it as the picker and "absent" could never hold.
 */
export function nativePickerButtons(page: Page): { byIcon: Locator; byText: Locator } {
  const dialog: Locator = page.getByRole('dialog');
  return {
    byIcon: dialog.locator('button').filter({ has: page.locator('svg.lucide-folder-open') }),
    byText: dialog.locator('button').filter({ hasText: 'Browse Files' }),
  };
}

/** The browser upload: the drop zone, which is also the click-to-browse control. */
export function browserDropZone(page: Page): Locator {
  return page.getByRole('button').filter({ hasText: /Drop file here or/i });
}

/**
 * The native button is not offered. Absence is the default state of the DOM, so this
 * first requires the dialog to have settled (the drop zone is shown with the agent's
 * size answer, not "Checking...") and then samples the button's count, with the drop
 * zone still present, across `settleMs`: the button is drawn until the capability
 * answer lands, so one early zero would prove nothing.
 */
export async function nativeButtonAbsent(page: Page, settleMs: number): Promise<boolean> {
  const { byIcon, byText } = nativePickerButtons(page);
  const settled: boolean = await isVisibleWithin(page.getByText(/Maximum file size:/), 15000);
  if (!settled || !(await isVisibleWithin(browserDropZone(page), 3000))) return false;
  const until: number = Date.now() + settleMs;
  do {
    const [icon, text, zone]: number[] = await Promise.all([byIcon.count(), byText.count(), browserDropZone(page).count()]);
    if (icon !== 0 || text !== 0 || zone !== 1) return false;
    await sleep(250);
  } while (Date.now() < until);
  return true;
}

/** Choose `name` through the browser's own chooser and send it; the dialog closing is the send. */
export async function sendThroughBrowser(page: Page, name: string, content: string): Promise<boolean> {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
  const dialog: Locator = page.getByRole('dialog');
  const send: Locator = dialog.getByTestId('file-send');
  if (!(await isVisibleWithin(send, 10000))) return false;
  await send.click();
  return dialog.waitFor({ state: 'hidden', timeout: 15000 }).then(() => true, () => false);
}

/**
 * The receiver is offered the transfer, accepts it, and the bubble reaches `complete`.
 * The bytes move agent to agent, so the page never holds them and cannot compare content;
 * the bubble carries the file's name and its state, which is what the page knows.
 */
export async function receiveAndVerify(page: Page, fileName: string, maxWaitMs: number): Promise<{ offered: boolean; transferred: boolean }> {
  const bubble: Locator = page.getByTestId('file-transfer-bubble').filter({ hasText: fileName });
  const accept: Locator = bubble.getByTestId('file-transfer-accept');
  if (!(await isVisibleWithin(accept, 20000))) return { offered: false, transferred: false };
  // The receiver's first offer from this peer asks "always accept?" over the button.
  await keepAskingEachTime(page, 10000);
  await accept.click();
  const done: Locator = page.locator('[data-testid="file-transfer-bubble"][data-transfer-state="complete"]').filter({ hasText: fileName });
  return { offered: true, transferred: await isVisibleWithin(done, maxWaitMs) };
}

const BROWSER_FILE: string = 'browser-path.txt';

export interface FallbackResult {
  nativeButtonAbsent: boolean;
  browserUploadOffered: boolean;
  browserTransferOffered: boolean;
  browserTransferCompleted: boolean;
  pickFileRequestSent: boolean;
}

/** The whole contract for an agent that says it has no picker: nothing native, the browser path works. */
export async function runBrowserFallback(sender: Page, receiver: Page, frames: PickerFrames, content: string): Promise<FallbackResult> {
  const nativeButtonGone: boolean = await nativeButtonAbsent(sender, 3000);
  const browserUploadOffered: boolean = await isVisibleWithin(browserDropZone(sender), 3000);
  const sent: boolean = await sendThroughBrowser(sender, BROWSER_FILE, content);
  const received: { offered: boolean; transferred: boolean } = sent ? await receiveAndVerify(receiver, BROWSER_FILE, 30000) : { offered: false, transferred: false };
  return {
    nativeButtonAbsent: nativeButtonGone,
    browserUploadOffered,
    browserTransferOffered: received.offered,
    browserTransferCompleted: received.transferred,
    pickFileRequestSent: frames.pickFileSent() > 0,
  };
}
