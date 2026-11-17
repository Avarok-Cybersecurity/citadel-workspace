/**
 * Test Diagnostics - Unified console error/warning collector and white-screen detector
 *
 * Usage:
 *   const diagnostics = await startDiagnostics(page);
 *   // ... run your test ...
 *   await diagnostics.stop(); // Prints report and returns summary
 */

import type { Page } from 'playwright';
import { formatConsoleLine } from './console-line.js';

export type ConsoleMessageType = 'log' | 'debug' | 'info' | 'warning' | 'error' | 'pageerror';

export interface ConsoleMessage {
  timestamp: string;
  type: ConsoleMessageType;
  text: string;
  location?: string;
}

export interface WhiteScreenCheck {
  timestamp: string;
  isWhiteScreen: boolean;
  rootContentLength: number;
  bodyTextLength: number;
}

export interface DiagnosticsReport {
  duration: number;
  consoleMessages: ConsoleMessage[];
  warnings: ConsoleMessage[];
  errors: ConsoleMessage[];
  pageErrors: ConsoleMessage[];
  whiteScreenChecks: WhiteScreenCheck[];
  hadWhiteScreen: boolean;
  summary: {
    totalMessages: number;
    warningCount: number;
    errorCount: number;
    pageErrorCount: number;
    whiteScreenDetected: boolean;
  };
}

export interface DiagnosticsHandle {
  /**
   * Stop diagnostics collection and print/return the report
   */
  stop: () => Promise<DiagnosticsReport>;

  /**
   * Get current messages without stopping
   */
  getMessages: () => ConsoleMessage[];

  /**
   * Check for white screen now
   */
  checkWhiteScreen: () => Promise<WhiteScreenCheck>;

  /**
   * Get current errors/warnings
   */
  getErrors: () => ConsoleMessage[];
  getWarnings: () => ConsoleMessage[];
}

/**
 * Start diagnostics collection for a page
 *
 * @param page - Playwright page to monitor
 * @param options - Configuration options
 * @returns DiagnosticsHandle to control and retrieve diagnostics
 */
export async function startDiagnostics(
  page: Page,
  options: {
    /** Check for white screen every N milliseconds (default: 2000) */
    whiteScreenCheckInterval?: number;
    /** Print messages in real-time (default: false) */
    realTimePrint?: boolean;
    /** Only print errors and warnings in real-time (default: true if realTimePrint) */
    realTimeOnlyErrors?: boolean;
  } = {}
): Promise<DiagnosticsHandle> {
  const {
    whiteScreenCheckInterval = 2000,
    realTimePrint = false,
    realTimeOnlyErrors = true,
  } = options;

  const startTime = Date.now();
  const messages: ConsoleMessage[] = [];
  const whiteScreenChecks: WhiteScreenCheck[] = [];
  let whiteScreenIntervalId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  // Helper to add message
  const addMessage = (type: ConsoleMessageType, text: string, location?: string) => {
    const msg: ConsoleMessage = {
      timestamp: new Date().toISOString(),
      type,
      text,
      location,
    };
    messages.push(msg);

    if (realTimePrint) {
      const shouldPrint = !realTimeOnlyErrors || type === 'error' || type === 'warning' || type === 'pageerror';
      if (shouldPrint) {
        const prefix = type === 'error' || type === 'pageerror' ? '❌' : type === 'warning' ? '⚠️' : '📝';
        console.log(`  ${prefix} [${type.toUpperCase()}] ${formatConsoleLine(text)}`);
      }
    }
  };

  // Console message handler
  const consoleHandler = (msg: import('playwright').ConsoleMessage) => {
    if (stopped) return;
    const type = msg.type() as ConsoleMessageType;
    const location = msg.location();
    const locationStr = location ? `${location.url}:${location.lineNumber}` : undefined;
    addMessage(type, msg.text(), locationStr);
  };

  // Page error handler
  const pageErrorHandler = (err: Error) => {
    if (stopped) return;
    addMessage('pageerror', `${err.message}\n${err.stack || ''}`);
  };

  // Register handlers
  page.on('console', consoleHandler);
  page.on('pageerror', pageErrorHandler);

  // White screen checker
  const checkWhiteScreen = async (): Promise<WhiteScreenCheck> => {
    try {
      const result = await page.evaluate(() => {
        const root = document.getElementById('root');
        return {
          rootContentLength: root?.innerHTML.length || 0,
          bodyTextLength: document.body.innerText.trim().length || 0,
        };
      });

      const check: WhiteScreenCheck = {
        timestamp: new Date().toISOString(),
        isWhiteScreen: result.rootContentLength === 0 && result.bodyTextLength < 50,
        rootContentLength: result.rootContentLength,
        bodyTextLength: result.bodyTextLength,
      };

      whiteScreenChecks.push(check);

      if (check.isWhiteScreen && realTimePrint) {
        console.log(`  🖥️ [WHITE-SCREEN] Detected at ${check.timestamp} (root: ${check.rootContentLength}, body: ${check.bodyTextLength})`);
      }

      return check;
    } catch (e) {
      // Page might be navigating
      return {
        timestamp: new Date().toISOString(),
        isWhiteScreen: false,
        rootContentLength: -1,
        bodyTextLength: -1,
      };
    }
  };

  // Start white screen polling
  whiteScreenIntervalId = setInterval(() => {
    if (!stopped) {
      void checkWhiteScreen();
    }
  }, whiteScreenCheckInterval);

  // Initial white screen check
  await checkWhiteScreen();

  const getMessages = () => [...messages];
  const getWarnings = () => messages.filter(m => m.type === 'warning');
  const getErrors = () => messages.filter(m => m.type === 'error' || m.type === 'pageerror');

  const stop = async (): Promise<DiagnosticsReport> => {
    stopped = true;

    // Stop polling
    if (whiteScreenIntervalId) {
      clearInterval(whiteScreenIntervalId);
      whiteScreenIntervalId = null;
    }

    // Remove handlers
    page.off('console', consoleHandler);
    page.off('pageerror', pageErrorHandler);

    // Final white screen check
    await checkWhiteScreen();

    const duration = Date.now() - startTime;
    const warnings = getWarnings();
    const errors = messages.filter(m => m.type === 'error');
    const pageErrors = messages.filter(m => m.type === 'pageerror');
    const hadWhiteScreen = whiteScreenChecks.some(c => c.isWhiteScreen);

    const report: DiagnosticsReport = {
      duration,
      consoleMessages: messages,
      warnings,
      errors,
      pageErrors,
      whiteScreenChecks,
      hadWhiteScreen,
      summary: {
        totalMessages: messages.length,
        warningCount: warnings.length,
        errorCount: errors.length,
        pageErrorCount: pageErrors.length,
        whiteScreenDetected: hadWhiteScreen,
      },
    };

    // Print report
    printDiagnosticsReport(report);

    return report;
  };

  return {
    stop,
    getMessages,
    checkWhiteScreen,
    getErrors,
    getWarnings,
  };
}

/**
 * Print diagnostics report to stdout
 */
export function printDiagnosticsReport(report: DiagnosticsReport): void {
  console.log('\n' + '═'.repeat(60));
  console.log('DIAGNOSTICS REPORT');
  console.log('═'.repeat(60));
  console.log(`Duration: ${(report.duration / 1000).toFixed(2)}s`);
  console.log(`Total console messages: ${report.summary.totalMessages}`);
  console.log(`Warnings: ${report.summary.warningCount}`);
  console.log(`Errors: ${report.summary.errorCount}`);
  console.log(`Page errors: ${report.summary.pageErrorCount}`);
  console.log(`White screen detected: ${report.summary.whiteScreenDetected ? '⚠️ YES' : '✅ No'}`);

  // Print errors first (most important)
  if (report.pageErrors.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('PAGE ERRORS (JavaScript exceptions):');
    console.log('─'.repeat(60));
    report.pageErrors.forEach((msg, i) => {
      console.log(`\n[${i + 1}] ${msg.timestamp}`);
      console.log(msg.text);
    });
  }

  if (report.errors.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('CONSOLE ERRORS:');
    console.log('─'.repeat(60));
    report.errors.forEach((msg, i) => {
      console.log(`[${i + 1}] ${msg.timestamp} ${formatConsoleLine(msg.text)}`);
    });
  }

  if (report.warnings.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('CONSOLE WARNINGS:');
    console.log('─'.repeat(60));
    report.warnings.forEach((msg, i) => {
      console.log(`[${i + 1}] ${msg.timestamp} ${formatConsoleLine(msg.text)}`);
    });
  }

  // Print white screen events
  const whiteScreenEvents = report.whiteScreenChecks.filter(c => c.isWhiteScreen);
  if (whiteScreenEvents.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('WHITE SCREEN EVENTS:');
    console.log('─'.repeat(60));
    whiteScreenEvents.forEach((check, i) => {
      console.log(`[${i + 1}] ${check.timestamp} - root: ${check.rootContentLength} bytes, body: ${check.bodyTextLength} chars`);
    });
  }

  console.log('\n' + '═'.repeat(60));
}

/**
 * Quick check if page currently has white screen
 */
export async function isWhiteScreen(page: Page): Promise<boolean> {
  try {
    const result = await page.evaluate(() => {
      const root = document.getElementById('root');
      const rootLen = root?.innerHTML.length || 0;
      const bodyLen = document.body.innerText.trim().length || 0;
      return rootLen === 0 && bodyLen < 50;
    });
    return result;
  } catch {
    return false;
  }
}
