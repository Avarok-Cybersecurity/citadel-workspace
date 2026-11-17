/**
 * Type definitions for integration tests
 */

export interface TestConfig {
  BASE_URL: string;
  INTERNAL_SERVICE_URL: string;
  WORKSPACE_SERVER: string;
  WORKSPACE_PASSWORD: string;
  DEFAULT_PASSWORD: string;
  SCREENSHOTS_DIR: string;
  LOGS_DIR: string;
}

export type UxSeverity = 'critical' | 'major' | 'minor' | 'suggestion';
export type UxCategory = 'visual' | 'functional' | 'performance' | 'accessibility';

export interface UxIssue {
  severity: UxSeverity;
  category: UxCategory;
  description: string;
  screenshot: string | null;
  timestamp: string;
}

export interface CreateAccountOptions {
  isFirstUser?: boolean;
  password?: string;
  uxTracker?: import('./ux-tracker.js').UxIssueTracker | null;
}

export interface BrowserOptions {
  headless?: boolean;
  slowMo?: number;
}

export interface BrowserSetup {
  browser: import('playwright').Browser;
  context: import('playwright').BrowserContext;
}

export interface DebugObservation {
  timestamp: string;
  iteration: number;
  phase: string;
  observation: string;
  details: Record<string, unknown>;
  status: 'investigating' | 'implemented' | 'verified' | 'failed';
}

export interface TestReport {
  timestamp: string;
  [key: string]: unknown;
}
