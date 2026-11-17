/**
 * Playwright global setup.
 *
 * Makes the suite independent of the order its specs happen to run in.
 *
 * The workspace server grants EditTreeStructure to exactly one account: whoever
 * initialises the workspace. Every spec used to register with
 * `isFirstUser: true` and assume it would be that account — true only for the
 * spec that got there first. Whichever ran earliest became admin and the rest
 * silently became ordinary members, so a spec that creates nodes failed with
 * "Permission denied: EditTreeStructure required" purely because of alphabetical
 * filename order. Running a single file passed; running the suite did not.
 *
 * This registers one admin up front and writes its credentials where specs can
 * read them, so "who is the admin" is a fixed fact rather than a race.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccount } from './lib/account.js';
import { waitForAppReady, clearBrowserStorage } from './lib/browser.js';
import { waitForWorkspaceLoaded, closeAnyModals } from './lib/modals.js';
import { config, isCI, isHeaded } from './lib/config.js';
import { restartBackendServices } from './lib/service-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Where the admin credentials land. Read by adminCredentials() in lib/admin.ts. */
export const ADMIN_STATE_PATH = join(__dirname, '..', '.auth', 'admin.json');

export interface AdminCredentials {
  username: string;
  password: string;
  /** True when this run created the workspace, false when one already existed. */
  initialisedWorkspace: boolean;
}

export default async function globalSetup(): Promise<void> {
  // Start from a known backend.
  //
  // The legacy specs each restart the services; the Playwright ones never did,
  // so a long run degraded itself — sessions, accounts and tree nodes piled up
  // across it, the landing page grew an Active Sessions navbar that changed the
  // tab order, and workspace loads started timing out. The failures that
  // produces look like product bugs and get investigated as such: office-room-crud
  // failed at the end of a 6-minute run and passed in 37s against a fresh stack.
  //
  // The services are in-memory by design (see CLAUDE.md), so this costs a
  // restart and buys a suite whose results mean the same thing every time.
  await restartBackendServices();

  const username = `pw_admin_${Date.now()}`;
  const password = config.DEFAULT_PASSWORD;

  const browser = await chromium.launch({
    headless: !isHeaded,
    args: isCI ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
  });

  try {
    const page = await browser.newPage();
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await waitForAppReady(page, 60_000);

    console.log(`[global-setup] Registering workspace admin: ${username}`);
    const registered = await createAccount(page, username, {
      isFirstUser: true,
      password,
      uxTracker: null,
    });

    if (!registered) {
      throw new Error(
        `[global-setup] Could not register ${username}. The workspace server is ` +
          'reachable but registration failed — check `docker compose logs server`.'
      );
    }

    await waitForWorkspaceLoaded(page, 30_000);
    await closeAnyModals(page);

    // ADMIN SETTINGS is the permission itself, not a proxy for it. The add-node
    // button is enabled for every user once the tree schema loads and only fails
    // server-side, so it cannot distinguish an admin from a member.
    const initialisedWorkspace = await page
      .locator('text="ADMIN SETTINGS"')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    console.log(
      initialisedWorkspace
        ? `[global-setup] ${username} initialised the workspace and is admin`
        : `[global-setup] A workspace already existed; ${username} is a member, ` +
          'so specs needing EditTreeStructure will skip. Reset with ' +
          '`docker compose down && docker compose up -d` for full coverage.'
    );

    const credentials: AdminCredentials = { username, password, initialisedWorkspace };
    mkdirSync(dirname(ADMIN_STATE_PATH), { recursive: true });
    writeFileSync(ADMIN_STATE_PATH, JSON.stringify(credentials, null, 2));
  } finally {
    await browser.close();
  }
}
