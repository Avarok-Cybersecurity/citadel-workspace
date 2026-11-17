/**
 * Test report generation
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TestReport } from './types.js';

/**
 * Write test results to a JSON file in the reports/ subdirectory
 */
export function writeTestReport(filename: string, results: Record<string, unknown>): void {
  const report: TestReport = {
    timestamp: new Date().toISOString(),
    ...results,
  };

  // Ensure reports directory exists
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = path.join(reportsDir, filename);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);
}
