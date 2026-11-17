/**
 * The world the multi-window spec starts from: one browser, three contexts,
 * two accounts that are P2P-registered and talking.
 *
 * Separate contexts share no storage and no BroadcastChannel, so each opens its
 * own WebSocket to the agent: to the agent they are three browsers. Same-browser
 * windows are made later with `context.newPage()`.
 */
import type { Browser, BrowserContext, Page } from 'playwright';
import { createBrowser, createIsolatedContexts, setupConsoleCapture } from './browser.js';
import { createAccount } from './account.js';
import { waitForWorkspaceLoaded } from './modals.js';
import { p2pRegister, acceptP2PRequest, openConversation } from './p2p.js';
import { sendAndVerifyMessage } from './messaging.js';
import { watchSessionPrompts, type PromptWatch } from './multi-window.js';
import type { UxIssueTracker } from './ux-tracker.js';

/** What every window of this spec prints from its console: the session plumbing the spec is about. */
export const MULTI_WINDOW_CAPTURE: readonly string[] = ['error', 'AttachSession', 'ClaimSession', 'Sessions', 'ConversationEvent', 'Detached', 'Disconnect'];

export interface MultiWindowWorld {
  browser: Browser;
  /** A's first window. */
  a1Context: BrowserContext;
  /** A's second browser: it joins with "Open here too". */
  a2Context: BrowserContext;
  bContext: BrowserContext;
  a1: Page;
  b: Page;
  a1Prompts: PromptWatch;
  a2Prompts: PromptWatch;
}

export async function openMultiWindowWorld(): Promise<MultiWindowWorld> {
  const { browser, context: a1Context } = await createBrowser();
  const [a2Context, bContext] = await createIsolatedContexts(browser, 2);
  // Before any page exists, so the very first render of every page is watched.
  const a1Prompts: PromptWatch = await watchSessionPrompts(a1Context, 'A/window 1');
  const a2Prompts: PromptWatch = await watchSessionPrompts(a2Context, 'A/window 2');
  const a1: Page = await a1Context.newPage();
  const b: Page = await bContext.newPage();
  setupConsoleCapture(a1, 'A/window 1', [...MULTI_WINDOW_CAPTURE]);
  setupConsoleCapture(b, 'B', [...MULTI_WINDOW_CAPTURE]);
  return { browser, a1Context, a2Context, bContext, a1, b, a1Prompts, a2Prompts };
}

export interface PeersReady { accounts: boolean; registered: boolean; conversations: boolean; talking: boolean }

/**
 * Create A and B, register them, open their chat and exchange one message each
 * way, with the suite's existing helpers.
 *
 * The warm-up uses the retrying sender on purpose: it establishes the channel,
 * and nothing is judged on it. Every message the spec DOES judge is sent once,
 * because a retry would hide both a loss and a duplicate.
 */
export async function makePeers(world: MultiWindowWorld, a: string, b: string, uxTracker: UxIssueTracker): Promise<PeersReady> {
  const ready: PeersReady = { accounts: false, registered: false, conversations: false, talking: false };
  ready.accounts = (await createAccount(world.a1, a, { isFirstUser: true, uxTracker }))
    && (await waitForWorkspaceLoaded(world.a1, 60_000))
    && (await createAccount(world.b, b, { isFirstUser: false, uxTracker }))
    && (await waitForWorkspaceLoaded(world.b, 60_000));
  if (!ready.accounts) return ready;

  ready.registered = (await p2pRegister(world.a1, a, b, { uxTracker })) && (await acceptP2PRequest(world.b, b, uxTracker, a));
  if (!ready.registered) return ready;

  ready.conversations = (await openConversation(world.a1, a, b, uxTracker)) && (await openConversation(world.b, b, a, uxTracker));
  if (!ready.conversations) return ready;

  const retrying = { maxRetries: 3, verifyTimeout: 20_000, retryDelay: 3_000, uxTracker };
  ready.talking = (await sendAndVerifyMessage(world.a1, a, world.b, b, `warm-up from ${a}`, retrying))
    && (await sendAndVerifyMessage(world.b, b, world.a1, a, `warm-up from ${b}`, retrying));
  return ready;
}
