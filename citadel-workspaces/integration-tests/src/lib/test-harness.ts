/**
 * Test Harness
 *
 * Encapsulates the repeated init/finalize boilerplate shared across integration tests:
 * - Banner printing, screenshots dir, UxIssueTracker, service readiness
 * - UX issue reporting, observation logging, test report writing
 * - Entry point wrapper (runTest → process.exit)
 */

import { ensureScreenshotsDir } from './screenshots.js';
import { UxIssueTracker } from './ux-tracker.js';
import { waitForServicesAlive } from './utils.js';
import { restartBackendServices } from './service-helpers.js';
import { logObservation } from './observation.js';
import { writeTestReport } from './report.js';

export interface TestHarnessConfig {
  testName: string;
  /** Report file name (e.g. 'P2P_TEST_REPORT.json'). Omit to skip report writing. */
  reportFileName?: string;
  /** Extra metadata logged with test-start observation */
  metadata?: Record<string, unknown>;
  /**
   * Restart backend services before the test. REQUIRED — not optional, and
   * deliberately has no default.
   *
   * Specs share one backend, so a spec that does not reset it inherits every
   * account and orphaned session the previous spec left behind. That is not a
   * theoretical hazard: `hard-disconnect-offline` failed in a batch run because
   * seven stale sessions from earlier specs were auto-reconnecting over the
   * landing page, so its login click never reached the form.
   *
   * Pass `false` only if the spec genuinely needs the previous state, and say why.
   */
  restartBackend: boolean;
}

export class TestHarness {
  readonly uxTracker: UxIssueTracker;
  private readonly config: TestHarnessConfig;

  private constructor(config: TestHarnessConfig, uxTracker: UxIssueTracker) {
    this.config = config;
    this.uxTracker = uxTracker;
  }

  /**
   * Create and initialize a test harness.
   * Prints banner, ensures screenshots dir, optionally restarts backend, waits for services.
   */
  static async create(config: TestHarnessConfig): Promise<TestHarness> {
    // Banner
    console.log('='.repeat(60));
    console.log(config.testName.toUpperCase());
    console.log('='.repeat(60));

    // Init
    ensureScreenshotsDir();
    const uxTracker = new UxIssueTracker();

    if (config.restartBackend) {
      await restartBackendServices();
    }

    await waitForServicesAlive();

    logObservation('test-start', `${config.testName} Started`, {
      ...config.metadata,
      timestamp: new Date().toISOString(),
    }, 'investigating');

    return new TestHarness(config, uxTracker);
  }

  /**
   * Print UX issues in the standard format.
   */
  printUxIssues(): void {
    const issues = this.uxTracker.getIssues();
    if (issues.length > 0) {
      console.log('\n' + '\u2500'.repeat(50));
      console.log('UX ISSUES FOUND:');
      console.log('\u2500'.repeat(50));
      issues.forEach((issue, i) => {
        console.log(`\n${i + 1}. [${issue.severity.toUpperCase()}] ${issue.category}`);
        console.log(`   ${issue.description}`);
      });
    } else {
      console.log('\nNo UX issues detected!');
    }
  }

  /**
   * Finalize the test: print UX issues, log completion observation, write report.
   */
  finalize(passed: boolean, results: Record<string, any>): void {
    this.printUxIssues();

    const uxIssues = this.uxTracker.getIssues();

    console.log('\n' + '='.repeat(60));
    console.log(`OVERALL: ${passed ? 'TEST PASSED' : 'TEST FAILED'}`);
    console.log('='.repeat(60));

    logObservation(
      'test-complete',
      `${this.config.testName} ${passed ? 'PASSED' : 'FAILED'}`,
      { results, uxIssuesCount: uxIssues.length },
      passed ? 'verified' : 'failed',
    );

    if (this.config.reportFileName) {
      writeTestReport(this.config.reportFileName, {
        testName: this.config.testName,
        ...this.config.metadata,
        results,
        uxIssues,
        passed,
      });
    }
  }
}

/**
 * Standard entry point wrapper for integration tests.
 * Replaces the repeated `runTest().then(passed => process.exit(...)).catch(...)` block.
 */
export function runTestMain(testFn: () => Promise<boolean>): void {
  testFn().then(passed => {
    process.exit(passed ? 0 : 1);
  }).catch(error => {
    console.error('Test failed with error:', error);
    process.exit(1);
  });
}
