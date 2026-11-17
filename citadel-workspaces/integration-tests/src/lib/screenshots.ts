/**
 * Screenshot utilities
 */

import * as fs from 'fs';
import type { Page } from 'playwright';
import { config } from './config.js';

/**
 * Ensure screenshots directory exists
 */
export function ensureScreenshotsDir(clean = false): void {
  if (clean && fs.existsSync(config.SCREENSHOTS_DIR)) {
    fs.rmSync(config.SCREENSHOTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(config.SCREENSHOTS_DIR)) {
    fs.mkdirSync(config.SCREENSHOTS_DIR, { recursive: true });
  }
}

/**
 * Take a screenshot
 */
export async function takeScreenshot(page: Page, name: string, fullPage = true): Promise<string | null> {
  try {
    const screenshotPath = `${config.SCREENSHOTS_DIR}/${name}.png`;
    await page.screenshot({ path: screenshotPath, fullPage, timeout: 10000 });
    console.log(`  Screenshot: ${name}.png`);
    return screenshotPath;
  } catch (e) {
    const error = e as Error;
    console.log(`  Screenshot failed: ${name} (${error.message})`);
    return null;
  }
}
