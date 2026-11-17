/**
 * A picture sent in chat, end to end on the live stack: the first offer asks "always accept?",
 * the picture shows in its bubble from the bytes the receiver's agent saved, the viewer opens it
 * full size, and both Download and a click on the file itself hand the browser the original
 * bytes under the original name.
 *
 * Only the live stack can prove this: the read over ReadPulledFileChunk depends on the agent
 * recording an accepted chat transfer (citadel-internal-service kernel/received_reads.rs), which
 * the unit and in-process tests prove on each side but not across a real agent and browser.
 * Written, not run, by the lane that added it (no shared-backend suites from lanes).
 */
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { multiUserTest as test } from '../fixtures/multi-user.fixture.js';
import { openConversation } from '../lib/index.js';
import { openChatFromMemberList } from './messaging-trust-helpers.js';

// A real 2x1 PNG.
const PNG: Buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGOQi1rw/8Mqm/8AE18E7d5tOQ0AAAAASUVORK5CYII=', 'base64');
const NAME: string = 'harbour at dusk.png';

test('a received picture shows, opens full size, and downloads as the original', async ({ userA, userB }) => {
  test.setTimeout(480_000);
  await openChatFromMemberList(userA.page, userB.username);
  await expect(userA.page.getByTestId('p2p-message-input')).toHaveAttribute('placeholder', 'Type a message...', { timeout: 120_000 });
  expect(await openConversation(userB.page, userB.username, userA.username), 'B opens the chat').toBe(true);

  await userA.page.getByTestId('p2p-send-file').click();
  await userA.page.locator('input[type="file"]').setInputFiles({ name: NAME, mimeType: 'image/png', buffer: PNG });
  await userA.page.getByTestId('file-send').click();

  // B: the first offer from A asks once; "always" accepts this one too.
  const ask = userB.page.getByTestId('always-accept-dialog');
  await expect(ask).toBeVisible({ timeout: 120_000 });
  await expect(userB.page.getByTestId('always-accept-directions')).toContainText('Chat settings');
  await ask.getByTestId('always-accept-yes').click();
  await expect(ask).toHaveCount(0);

  // The picture shows from the agent's bytes (a blob: URL, not the sender's thumbnail).
  const picture = userB.page.getByTestId('transfer-picture').first();
  await expect(picture.locator('img[data-shown="picture"]')).toHaveAttribute('src', /^blob:/, { timeout: 120_000 });

  // Full size, then Download: the original bytes under the original name.
  await picture.click();
  const viewer = userB.page.getByTestId('picture-viewer');
  await expect(viewer).toBeVisible();
  const [fromViewer] = await Promise.all([userB.page.waitForEvent('download'), viewer.getByTestId('picture-viewer-download').click()]);
  expect(fromViewer.suggestedFilename()).toBe(NAME);
  expect(Buffer.compare(await readFile(await fromViewer.path()), PNG)).toBe(0);
  await userB.page.keyboard.press('Escape');

  // Clicking the file itself downloads it too (no path in the agent's data directory).
  const [fromBubble] = await Promise.all([userB.page.waitForEvent('download'), userB.page.getByTestId('file-transfer-open').first().click()]);
  expect(fromBubble.suggestedFilename()).toBe(NAME);
  expect(Buffer.compare(await readFile(await fromBubble.path()), PNG)).toBe(0);

  // A second offer from A is accepted without asking.
  await userA.page.getByTestId('p2p-send-file').click();
  await userA.page.locator('input[type="file"]').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: PNG });
  await userA.page.getByTestId('file-send').click();
  await expect(userB.page.getByTestId('transfer-picture').nth(1)).toBeVisible({ timeout: 120_000 });
  await expect(ask).toHaveCount(0);
});
