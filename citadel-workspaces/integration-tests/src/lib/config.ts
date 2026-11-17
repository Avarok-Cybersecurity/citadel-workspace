/**
 * Test configuration
 *
 * Reads from test.config.json in the project root.
 * To change workspace server, edit test.config.json:
 * {
 *   "workspaceServer": {
 *     "host": "127.0.0.1",
 *     "port": 12349
 *   }
 * }
 */

import * as path from 'path';
import * as fs from 'fs';
import type { TestConfig } from './types.js';

interface ExternalConfig {
  baseUrl?: string;
  internalServiceUrl?: string;
  workspaceServer?: {
    host: string;
    port: number;
  };
  workspacePassword?: string;
  defaultPassword?: string;
}

function loadExternalConfig(): ExternalConfig {
  const configPath = path.join(process.cwd(), 'test.config.json');
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as ExternalConfig;
    }
  } catch (error) {
    console.warn(`Warning: Could not load test.config.json: ${error}`);
  }
  return {};
}

const externalConfig = loadExternalConfig();

// CI detection - headless mode when running in CI
export const isCI = process.env.IN_CI === 'true' || process.env.CI === 'true';

/**
 * Show the browser. Off by default, including locally.
 *
 * These specs used to run headed whenever they were not in CI, which meant a
 * real Chromium window opening — and stealing focus — for every spec in a run.
 * On a developer's machine that is not a convenience, it is an interruption:
 * keystrokes land in the test's browser instead of wherever they were typing,
 * repeatedly, for as long as the suite runs.
 *
 * Watching a spec is still one variable away: HEADED=1 npm run test:whatever
 */
export const isHeaded = process.env.HEADED === '1' || process.env.HEADED === 'true';

export const config: TestConfig = {
  BASE_URL: externalConfig.baseUrl ?? 'http://127.0.0.1:5291',
  INTERNAL_SERVICE_URL: externalConfig.internalServiceUrl ?? 'http://127.0.0.1:12345',
  WORKSPACE_SERVER: externalConfig.workspaceServer
    ? `${externalConfig.workspaceServer.host}:${externalConfig.workspaceServer.port}`
    : '127.0.0.1:12349',
  // ENV FIRST, then the file. The server takes its master password from
  // WORKSPACE_MASTER_PASSWORD (docker-compose passes it straight through), so the
  // environment is the authority on what the running server will actually
  // accept. With the file winning, a committed value silently overrode reality:
  // initialisation was rejected at the password check, the first user never
  // became admin, and the symptom surfaced much later as unexplained
  // "permission denied" on every admin surface.
  WORKSPACE_PASSWORD: process.env.WORKSPACE_MASTER_PASSWORD ?? externalConfig.workspacePassword ?? 'dev-local-workspace-password',
  DEFAULT_PASSWORD: externalConfig.defaultPassword ?? 'test12345',
  SCREENSHOTS_DIR: path.join(process.cwd(), 'screenshots'),
  LOGS_DIR: path.join(process.cwd(), 'logs'),
};
