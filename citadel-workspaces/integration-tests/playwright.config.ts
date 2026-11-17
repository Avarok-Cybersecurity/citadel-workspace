import { defineConfig, devices } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Playwright Test configuration for Citadel Workspaces integration tests.
 *
 * Runs alongside the existing custom test runner. Use `npm run test:pw` to run
 * @playwright/test specs, and the existing `npm run test:*` for legacy tests.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ── Load test configuration from test.config.json ── */

interface ExternalConfig {
    baseUrl?: string;
    internalServiceUrl?: string;
    workspaceServer?: { host: string; port: number };
    workspacePassword?: string;
    defaultPassword?: string;
}

function loadConfig(): ExternalConfig {
    const configPath = join(__dirname, 'test.config.json');
    try {
        if (existsSync(configPath)) {
            return JSON.parse(readFileSync(configPath, 'utf-8')) as ExternalConfig;
        }
    } catch { /* use defaults */ }
    return {};
}

const externalConfig = loadConfig();
const isCI = process.env['IN_CI'] === 'true' || process.env['CI'] === 'true';

export default defineConfig({
    /**
     * Registers ONE workspace admin before any spec runs.
     *
     * The server grants EditTreeStructure to whoever initialises the workspace.
     * Without this, every spec registered with isFirstUser: true and assumed it
     * would be that account — true only for whichever file sorted first. A spec
     * that creates nodes then failed with "Permission denied" purely because of
     * alphabetical order: it passed when run alone and failed in the suite.
     */
    globalSetup: './src/global-setup.ts',

    /* Test directory for @playwright/test spec files */
    testDir: './src/tests-pw',
    testMatch: '**/*.spec.ts',

    /* Timeouts */
    timeout: 120_000,        // 2 min per test — WASM cold-start can be slow
    expect: { timeout: 10_000 },

    /* Retries for flaky E2E tests */
    // A committed `test.only()` silently reduces a whole shard to one test and
    // reports GREEN — the suite passes because it ran almost nothing. There is
    // none today and nothing prevented one; this is the standard guard.
    forbidOnly: isCI,

    retries: isCI ? 2 : 0,

    /* Sequential in CI to avoid resource contention; parallel locally */
    // One worker everywhere, not just in CI.
    //
    // Every spec runs against the same dev server, internal service and
    // workspace server, registering real accounts and mutating shared workspace
    // state. Two workers therefore interfere with each other, and the failures
    // that produces look exactly like product bugs — a dialog that "will not
    // close", a node that "is not in the sidebar" — so they get investigated as
    // such. Observed directly: the keyboard spec failed as a file and passed
    // when its one test was run alone.
    //
    // Local runs are slower for it. That is the cheaper cost.
    workers: 1,
    fullyParallel: false,

    /* Reporters */
    reporter: isCI
        ? [['html', { open: 'never' }], ['json', { outputFile: 'reports/results.json' }], ['list']]
        : [['html', { open: 'on-failure' }], ['list']],

    /* Shared settings for all projects */
    use: {
        baseURL: externalConfig.baseUrl ?? 'http://127.0.0.1:5291',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',

        /* Match existing browser.ts anti-throttling flags */
        launchOptions: {
            slowMo: isCI ? 0 : 50,
            args: [
                // Synthetic camera and microphone. Without these a call test
                // needs real hardware, which no CI runner has — and the
                // permission prompt would block the run before any assertion.
                // The fake camera emits a moving pattern, so a tile that
                // decodes it has genuinely carried video rather than merely
                // being present.
                '--use-fake-device-for-media-stream',
                '--use-fake-ui-for-media-stream',
                // And a synthetic SCREEN. `getDisplayMedia` opens a picker the
                // user must choose in, which no headless run can do -- without
                // this the promise never settles and the spec times out on a
                // dialog it cannot see. Chrome then answers with the first
                // available surface, which under `--use-fake-ui-for-media-stream`
                // is the fake one.
                '--auto-select-desktop-capture-source=Entire screen',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-ipc-flooding-protection',
                ...(isCI ? [
                    '--disable-dev-shm-usage',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-software-rasterizer',
                    '--js-flags=--max-old-space-size=512',
                    '--renderer-process-limit=2',
                    '--disable-features=TranslateUI',
                    '--disable-component-update',
                ] : []),
            ],
        },
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    /* Output directory for test artifacts (traces, screenshots, videos) */
    outputDir: './test-results/pw',
});
