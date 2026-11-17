/**
 * A chat's documents as a person reaches them: made from the composer's Live Doc type, opened
 * from the invitation's bubble, and both open in the Citadel Docs canvas, shared live with the
 * peer. What a document says is read the way the person would read it: "Download as… → Plain
 * text" (docs-document.ts). The canvas is painted, so nothing here reads the editor's DOM.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { downloadedText, firstPage } from './docs-document.js';
import { takeScreenshot } from './screenshots.js';

/** Long enough for the engine to load and a replica to open. */
export const CHAT_DOCUMENT_MS: number = 30_000;

export const chatDocumentPane = (page: Page): Locator => page.getByTestId('chat-document-pane');

/** The canvas is open: the chat's pane, a Docs host inside it, and its first page painted. */
export async function expectCanvasOpen(page: Page, title: string): Promise<string> {
  const pane: Locator = chatDocumentPane(page);
  await expect(pane, `"${title}" did not open in the canvas`).toBeVisible({ timeout: CHAT_DOCUMENT_MS });
  await expect(pane.getByTestId('document-host')).toHaveAttribute('data-app', 'docs', { timeout: CHAT_DOCUMENT_MS });
  await expect(pane.getByRole('heading', { level: 1 })).toHaveText(title, { timeout: CHAT_DOCUMENT_MS });
  await expect(firstPage(page)).toBeVisible({ timeout: CHAT_DOCUMENT_MS });
  const docId: string | null = await pane.getAttribute('data-document-id');
  expect(docId, 'the open document names no id').not.toBeNull();
  return docId ?? '';
}

/**
 * Makes a document from the open conversation's composer and returns its id, once the canvas is
 * open for it: a document made in a chat opens as soon as its invitation is in the conversation.
 */
export async function createChatDocument(page: Page, username: string, title: string): Promise<string> {
  console.log(`\n=== ${username}: making the chat document "${title}" ===`);
  await page.getByTestId('message-type-live-doc').first().click();
  const titleInput: Locator = page.getByTestId('live-doc-title');
  await expect(titleInput, 'the Live Doc dialog did not open').toBeVisible({ timeout: CHAT_DOCUMENT_MS });
  // The dialog preselects no app (CitadelAppPicker), so Create stays disabled until one is chosen.
  // The rows' own testids are composed (ChoiceList), so the app is taken by the radio's value.
  await page.getByTestId('live-doc-app').locator('button[value="docs"]').click();
  await titleInput.fill(title);
  await page.getByTestId('live-doc-create').click();
  await expect(titleInput, 'the Live Doc dialog stayed open').toBeHidden({ timeout: CHAT_DOCUMENT_MS });
  const docId: string = await expectCanvasOpen(page, title);
  expect(docId, 'a document made now is a Citadel Docs document').toMatch(/^cdoc-/);
  await takeScreenshot(page, `${username}_chat_document_made`);
  return docId;
}

/** Opens the document from its invitation's bubble in the open conversation. */
export async function openChatDocument(page: Page, username: string, title: string): Promise<void> {
  console.log(`\n=== ${username}: opening the chat document "${title}" ===`);
  // The title is data this test created, not copy the product chose.
  const bubble: Locator = page.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  await expect(bubble, `no invitation to "${title}" arrived`).toBeVisible({ timeout: CHAT_DOCUMENT_MS });
  await bubble.click();
}

/** Types `text` at the caret, where a click on the first page put it. */
export async function typeInChatDocument(page: Page, text: string): Promise<void> {
  await firstPage(page).click();
  await page.keyboard.type(text, { delay: 30 });
}

/** Whether the open document comes to say `text`, read from its plain-text download. */
export async function chatDocumentSays(page: Page, text: string, timeoutMs: number): Promise<boolean> {
  try {
    await expect.poll(async (): Promise<string> => downloadedText(page), { timeout: timeoutMs }).toContain(text);
    return true;
  } catch (error: unknown) {
    // The reason is the report's: a copy that never said it, or a read that could not be made.
    console.log(`  no read of the document showed "${text}": ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    return false;
  }
}

/** The open document's text, as its plain-text download has it. */
export const chatDocumentText = (page: Page): Promise<string> => downloadedText(page);
