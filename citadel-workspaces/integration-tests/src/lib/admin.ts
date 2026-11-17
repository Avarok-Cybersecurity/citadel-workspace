/**
 * Access to the workspace admin created by global-setup.
 *
 * The server grants EditTreeStructure to exactly one account — whoever
 * initialises the workspace. Specs that create or delete nodes need that
 * account; they cannot register their own and hope to be first.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_STATE_PATH = join(__dirname, '..', '..', '.auth', 'admin.json');

export interface AdminCredentials {
  username: string;
  password: string;
  initialisedWorkspace: boolean;
}

/**
 * Credentials for the admin global-setup registered.
 *
 * Throws rather than returning null: a spec that needs an admin and finds none
 * has a broken run, and failing here names the cause instead of surfacing it
 * later as a confusing "Permission denied" from the server.
 */
export function adminCredentials(): AdminCredentials {
  if (!existsSync(ADMIN_STATE_PATH)) {
    throw new Error(
      `No admin credentials at ${ADMIN_STATE_PATH}. global-setup should have ` +
        'written them — check that playwright.config.ts still sets globalSetup.'
    );
  }
  return JSON.parse(readFileSync(ADMIN_STATE_PATH, 'utf-8')) as AdminCredentials;
}

/**
 * Whether this run has an account that can edit the workspace tree.
 *
 * False when the server already held a workspace from an earlier run, so
 * global-setup's account joined as an ordinary member. Specs use this to skip
 * with a clear reason rather than fail on a permission error that says nothing
 * about test isolation.
 */
export function hasWorkspaceAdmin(): boolean {
  try {
    return adminCredentials().initialisedWorkspace;
  } catch {
    return false;
  }
}
