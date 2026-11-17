import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWasmDebugBridge } from './wasm-debug-bridge';

describe('WASM Debug Bridge', () => {
  let capturedLogs: string[][] = [];
  const originalConsoleLog: { (...data: unknown[]): void; (message?: unknown, ...optionalParams: unknown[]): void; } = console.log;

  beforeEach(() => {
    capturedLogs = [];
    // Mock console.log to capture all arguments
    // debugLog calls console.log('[Category]', ...args) with multiple arguments
    console.log = vi.fn((...args: unknown[]) => {
      capturedLogs.push(args.map(String));
    });

    // Set up the bridge
    setupWasmDebugBridge();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  /** Check if any captured log line contains the given substring (across all args) */
  function logContains(substring: string): boolean {
    return capturedLogs.some(args => args.some(arg => arg.includes(substring)));
  }

  /** Get the full joined log line that contains the substring */
  function findLog(substring: string): string | undefined {
    const entry: string[] | undefined = capturedLogs.find(args => args.some(arg => arg.includes(substring)));
    return entry?.join(' ');
  }

  it('should handle plain text', () => {
    window.wasmDebugLog('hello world 123');
    expect(logContains('sanitized log: hello world 123')).toBe(true);
  });

  it('should handle pure JSON', () => {
    window.wasmDebugLog('{"key": "value", "bytes": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}');
    expect(logContains('sanitized log:')).toBe(true);
    expect(logContains('BytesLike')).toBe(true);
  });

  it('should handle JSON at the beginning', () => {
    window.wasmDebugLog('{"key": "value"} hello world 456');
    expect(logContains('sanitized log:')).toBe(true);
    expect(logContains('hello world 456')).toBe(true);
  });

  it('should handle JSON in the middle', () => {
    window.wasmDebugLog('hello world 123 {"key": "value"} hello world 456');
    expect(logContains('sanitized log:')).toBe(true);
    expect(logContains('hello world 123')).toBe(true);
    expect(logContains('hello world 456')).toBe(true);
  });

  it('should handle multiple JSON objects', () => {
    window.wasmDebugLog('start {"key1": "value1"} middle {"key2": "value2"} end');
    expect(logContains('sanitized log:')).toBe(true);
    expect(logContains('start')).toBe(true);
    expect(logContains('middle')).toBe(true);
    expect(logContains('end')).toBe(true);
  });

  it('should handle invalid JSON gracefully', () => {
    window.wasmDebugLog('hello {invalid json} world');
    expect(logContains('sanitized log:')).toBe(true);
    expect(logContains('hello {invalid json} world')).toBe(true);
  });

  it('should handle nested JSON', () => {
    window.wasmDebugLog('data: {"outer": {"inner": [1, 2, 3]}} processed');
    expect(logContains('sanitized log:')).toBe(true);
    expect(logContains('data:')).toBe(true);
    expect(logContains('processed')).toBe(true);
  });

  it('should format byte arrays correctly', () => {
    window.wasmDebugLog('{"data": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}');
    expect(logContains('BytesLike')).toBe(true);
    expect(logContains('First 5 bytes')).toBe(true);
    expect(logContains('Last 5 bytes')).toBe(true);
  });

  it('should handle complex mixed content', () => {
    const complexInput: string = 'Start {"user": "john", "data": [1, 2, 3]} middle text {"status": "ok"} end';
    window.wasmDebugLog(complexInput);

    const sanitizedLog: string | undefined = findLog('sanitized log:');
    expect(sanitizedLog).toBeDefined();
    expect(sanitizedLog).toContain('Start');
    expect(sanitizedLog).toContain('middle text');
    expect(sanitizedLog).toContain('end');
    expect(sanitizedLog).toContain('user');
    expect(sanitizedLog).toContain('status');
  });

  it('should handle arrays as top-level JSON', () => {
    window.wasmDebugLog('[1, 2, 3, 4, 5]');
    expect(logContains('sanitized log:')).toBe(true);
    const sanitizedLog: string | undefined = findLog('sanitized log:');
    expect(sanitizedLog).toBeDefined();
    expect(sanitizedLog).toMatch(/\[.*1.*2.*3.*4.*5.*\]/);
  });

  it('should handle edge cases', () => {
    // Empty string
    window.wasmDebugLog('');
    expect(logContains('sanitized log: ')).toBe(true);

    // Just whitespace
    capturedLogs = [];
    window.wasmDebugLog('   ');
    expect(logContains('sanitized log:    ')).toBe(true);

    // Malformed JSON-like strings
    capturedLogs = [];
    window.wasmDebugLog('{broken json');
    expect(logContains('sanitized log: {broken json')).toBe(true);
  });
});
