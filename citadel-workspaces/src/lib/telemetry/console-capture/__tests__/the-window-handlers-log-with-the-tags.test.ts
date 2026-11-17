/**
 * main.tsx's window handlers are the only listeners for `error` and `unhandledrejection`; console
 * capture tells their lines apart by the tags they log first. main.tsx cannot be imported in a
 * unit test (it renders the app), so its source is read: both handlers must log with the shared
 * tags, and neither tag may be spelled out there, or the two could drift apart.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineFrom } from '../format';
import { REJECTION_TAG, WINDOW_ERROR_TAG } from '../../window-error-tags';

const MAIN: string = readFileSync(join(process.cwd(), 'src', 'main.tsx'), 'utf8');

describe('the window handlers in main.tsx', () => {
  it('log with the tags console capture reads', () => {
    expect(MAIN).toContain("window.addEventListener('error'");
    expect(MAIN).toContain('console.error(WINDOW_ERROR_TAG, {');
    expect(MAIN).toContain("window.addEventListener('unhandledrejection'");
    expect(MAIN).toContain('console.error(REJECTION_TAG, {');
    expect(MAIN).not.toContain(WINDOW_ERROR_TAG);
    expect(MAIN).not.toContain(REJECTION_TAG);
  });

  it('and so arrive as lines of their own source', () => {
    expect(lineFrom('error', [WINDOW_ERROR_TAG, { message: 'm', filename: 'f.js', lineno: 1, colno: 2 }]).source).toBe('WindowError');
    expect(lineFrom('error', [REJECTION_TAG, { reason: 'r', promise: null }]).source).toBe('UnhandledRejection');
  });
});
