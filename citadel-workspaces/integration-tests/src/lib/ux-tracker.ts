/**
 * UX Issue Tracking
 */

import type { UxSeverity, UxCategory, UxIssue } from './types.js';

export class UxIssueTracker {
  private issues: UxIssue[] = [];

  /**
   * Log a UX issue
   */
  log(severity: UxSeverity, category: UxCategory, description: string, screenshot: string | null = null): void {
    const issue: UxIssue = {
      severity,
      category,
      description,
      screenshot,
      timestamp: new Date().toISOString(),
    };
    this.issues.push(issue);
    console.log(`  [UX ${severity.toUpperCase()}/${category}]: ${description}`);
  }

  getIssues(): UxIssue[] {
    return this.issues;
  }

  clear(): void {
    this.issues = [];
  }
}
