/**
 * One account open in several windows (agent 0.8.6, multi-window mw5).
 *
 * The helpers here observe what a window SHOWS, never what the test asked for:
 * a bubble counted inside the chat, a prompt recorded the instant it is put in
 * the DOM, the account the top bar names. Each is written so the absence of the
 * feature turns it red; see the negative-control notes in
 * tests/multi-window.test.ts.
 */
import type { BrowserContext, Locator, Page } from 'playwright';
import { config } from './config.js';
import { waitForAppReady } from './browser.js';
import { waitForWorkspaceLoaded } from './modals.js';
import { signedInAs } from './signed-in-as.js';
import { isVisibleWithin, sleep } from './utils.js';

/** What a window can be asked before it gets a session another window holds. */
export type SessionPrompt =
  /** The password form of "Open here too" (OpenHereToo.tsx). */
  | 'open-here-too'
  /** "<user> is open in another window" -- the question asked before that form. */
  | 'takeover-question'
  /** The full-page notice a window shows when it was let go of its session. */
  | 'held-elsewhere';

export interface PromptWatch {
  /** How many times each prompt has APPEARED in any page of the context since the last reset. */
  seen: () => Readonly<Record<SessionPrompt, number>>;
  reset: () => void;
}

const NO_PROMPTS: Readonly<Record<SessionPrompt, number>> = { 'open-here-too': 0, 'takeover-question': 0, 'held-elsewhere': 0 };

/**
 * Record every appearance of a session prompt, in every page of `context`,
 * including pages opened later.
 *
 * Sampling "is a prompt showing?" after the fact passes whenever the prompt has
 * already gone, and an absence check passes for a selector that never matched.
 * This is a MutationObserver installed before the app's first script, reporting
 * each absent-to-present transition to the test, so a prompt that flashes for
 * one frame is still counted. Step 3 of the spec proves it can see each prompt
 * it is later used to rule out.
 */
export async function watchSessionPrompts(context: BrowserContext, label: string): Promise<PromptWatch> {
  let counts: Record<SessionPrompt, number> = { ...NO_PROMPTS };
  await context.exposeBinding('__multiWindowPromptSeen', (_source: unknown, prompt: SessionPrompt): void => {
    counts = { ...counts, [prompt]: counts[prompt] + 1 };
    console.log(`  [${label}] session prompt appeared: ${prompt}`);
  });
  await context.addInitScript((): void => {
    // Looked up per call: the binding is installed by Playwright, and is not promised to exist before this script runs.
    const report = (prompt: string): void => {
      void (window as unknown as { __multiWindowPromptSeen?: (p: string) => Promise<void> }).__multiWindowPromptSeen?.(prompt);
    };
    const showing: Set<string> = new Set();
    const present = (): string[] => {
      const found: string[] = [];
      if (document.querySelector('[data-testid="open-here-too"]')) found.push('open-here-too');
      if (document.querySelector('[data-testid="session-held-elsewhere"]')) found.push('held-elsewhere');
      const asked: boolean = Array.from(document.querySelectorAll('[role="alertdialog"]'))
        .some((dialog: Element) => (dialog.textContent ?? '').includes('is open in another'));
      if (asked) found.push('takeover-question');
      return found;
    };
    const check = (): void => {
      const now: string[] = present();
      for (const prompt of now) if (!showing.has(prompt)) { showing.add(prompt); report(prompt); }
      for (const prompt of Array.from(showing)) if (!now.includes(prompt)) showing.delete(prompt);
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return { seen: () => counts, reset: () => { counts = { ...NO_PROMPTS }; } };
}

/** Message bubbles in the open 1:1 chat whose text contains `text`. Scoped to the chat, so a toast or a sidebar preview never counts. */
export function chatBubbles(page: Page, text: string): Locator {
  return page.getByTestId('p2p-chat').locator('[data-message-id]').filter({ hasText: text });
}

export interface Delivery { label: string; ok: boolean; detail: string }

/**
 * The message is on screen ONCE, and stays once.
 *
 * Presence first -- a count of zero proves nothing about a duplicate -- then the
 * count is sampled across `settleMs`, because a duplicate is a second arrival
 * and arrives later. The maximum over the window is what is judged.
 */
export async function shownExactlyOnce(page: Page, label: string, text: string, arriveMs: number, settleMs: number): Promise<Delivery> {
  const bubbles: Locator = chatBubbles(page, text);
  if (!(await isVisibleWithin(bubbles.first(), arriveMs))) {
    return { label, ok: false, detail: `${label}: "${text}" never appeared within ${arriveMs}ms` };
  }
  let most: number = 0;
  let least: number = Number.POSITIVE_INFINITY;
  const until: number = Date.now() + settleMs;
  while (Date.now() < until) {
    const now: number = await bubbles.count();
    most = Math.max(most, now);
    least = Math.min(least, now);
    await sleep(200);
  }
  const ok: boolean = most === 1 && least === 1;
  return { label, ok, detail: `${label}: "${text}" shown ${least === most ? most : `${least}..${most}`} time(s) over ${settleMs}ms` };
}

/** Every window in `windows` shows `text` exactly once; judged together, so one slow window does not delay the others' sampling. */
export async function everyWindowShowsOnce(windows: ReadonlyArray<{ page: Page; label: string }>, text: string, arriveMs: number, settleMs: number): Promise<boolean> {
  const results: Delivery[] = await Promise.all(windows.map((w) => shownExactlyOnce(w.page, w.label, text, arriveMs, settleMs)));
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`);
  return results.every((r: Delivery) => r.ok);
}

/** Open the landing page and press `username`'s chip in the Active Sessions strip: the way into a session this window does not hold. */
export async function pressSessionChip(page: Page, username: string): Promise<boolean> {
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);
  const chip: Locator = page.getByTestId(`session-button-${username}`);
  if (!(await isVisibleWithin(chip, 30_000))) {
    console.log(`  ${username} is not in this window's Active Sessions strip`);
    return false;
  }
  await chip.click();
  return true;
}

/** The workspace is on screen AND it is `username`'s: chrome alone is the same for every account. */
export async function showsWorkspaceOf(page: Page, username: string, timeoutMs: number): Promise<boolean> {
  if (!(await waitForWorkspaceLoaded(page, timeoutMs))) return false;
  const who: string | null = await signedInAs(page, 20_000);
  if (who !== username) console.log(`  the workspace on screen is ${who ?? 'nobody named'}'s, not ${username}'s`);
  return who === username;
}

/**
 * "Open here too", as a person does it: the chip, the question, the password.
 *
 * Each step must be SEEN before the next is pressed, so a window that skipped
 * the question (took the session over silently, or was never asked) fails here
 * instead of looking like a join.
 */
export async function openHereTooWithPassword(page: Page, username: string, password: string): Promise<boolean> {
  if (!(await pressSessionChip(page, username))) return false;
  const question: Locator = page.getByRole('alertdialog').filter({ hasText: `${username} is open in another window` });
  if (!(await isVisibleWithin(question, 30_000))) {
    console.log('  the window was never asked to open the session here too');
    return false;
  }
  await page.getByTestId('confirm-dialog-confirm').click();
  const form: Locator = page.getByTestId('open-here-too');
  if (!(await isVisibleWithin(form, 15_000))) {
    console.log('  the "Open here too" password form never appeared');
    return false;
  }
  await form.getByTestId('open-here-too-password').fill(password);
  await form.getByTestId('open-here-too-submit').click();
  return showsWorkspaceOf(page, username, 60_000);
}

/** The join tokens this browser keeps, whether each is sealed rather than stored as bytes, and whose (lib/sessions/join-token.ts keys them by cid). */
export async function sealedJoinTokens(page: Page): Promise<{ count: number; allSealed: boolean; cids: string[] }> {
  return page.evaluate(async (): Promise<{ count: number; allSealed: boolean; cids: string[] }> => {
    const db: IDBDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const open: IDBOpenDBRequest = indexedDB.open('citadel-workspace');
      open.onsuccess = (): void => resolve(open.result);
      open.onerror = (): void => reject(open.error);
    });
    const rows: { key: IDBValidKey; value: unknown }[] = await new Promise((resolve, reject) => {
      const out: { key: IDBValidKey; value: unknown }[] = [];
      const cursor: IDBRequest<IDBCursorWithValue | null> = db.transaction('keyValue').objectStore('keyValue').openCursor();
      cursor.onsuccess = (): void => {
        const at: IDBCursorWithValue | null = cursor.result;
        if (!at) { resolve(out); return; }
        out.push({ key: at.key, value: at.value });
        at.continue();
      };
      cursor.onerror = (): void => reject(cursor.error);
    });
    db.close();
    const PREFIX: string = 'multi-window:join-token:';
    const held: { key: IDBValidKey; value: unknown }[] = rows.filter((r) => String(r.key).startsWith(PREFIX));
    const tokens: unknown[] = held.map((r) => r.value);
    const sealed = (v: unknown): boolean => {
      const s: { iv?: unknown; sealed?: unknown } = (v ?? {}) as { iv?: unknown; sealed?: unknown };
      return ArrayBuffer.isView(s.iv) && Object.prototype.toString.call(s.sealed) === '[object ArrayBuffer]';
    };
    return { count: tokens.length, allSealed: tokens.every(sealed), cids: held.map((r) => String(r.key).slice(PREFIX.length)) };
  });
}

/** Load the landing page and wait for `username`'s chip: the agent's live session list has arrived, and names that account. */
export async function landingListsSession(page: Page, username: string): Promise<boolean> {
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  return isVisibleWithin(page.getByTestId(`session-icon-${username}`), 30_000);
}
