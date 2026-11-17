/**
 * One console call as the line the agent is sent: its source, a bounded message and stack, and
 * nothing else of what was logged. Pure.
 *
 * Only strings, primitives and errors (name, message, stack) are read. Any other object is named,
 * not serialised: what an app logs beside an error can be anything, and the agent's redactor can
 * only remove what it recognises.
 *
 * A field over its budget is cut at a word boundary and the cut word dropped, because a secret
 * cut in half is a secret the redactor no longer recognises. The agent drops a field over its own
 * bound outright (BROWSER_FIELD_BYTES, citadel-workspace-internal-service/src/telemetry).
 */
import type { BrowserConsoleSource } from 'citadel-workspace-client-ts';
import { REJECTION_TAG, WINDOW_ERROR_TAG } from '../window-error-tags';

export interface ConsoleLine {
  readonly source: BrowserConsoleSource;
  readonly message: string;
  readonly stack: string | null;
}

export type ConsoleLevel = 'error' | 'warn';

export const MESSAGE_BYTES: number = 1024;
export const STACK_BYTES: number = 2048;
const CUT_MARK: string = ' [cut]';

/**
 * Lines raised by browser extensions, not by the app. The agent drops these too and is the
 * authority (telemetry/browser.rs); dropping them here keeps them from spending this page's budget.
 */
const EXTENSION_MARKERS: readonly string[] = [
  'chrome-extension://', 'moz-extension://', 'safari-extension://', 'safari-web-extension://', 'ms-browser-extension://', 'grammarly',
];

const encoder: TextEncoder = new TextEncoder();

interface Described { readonly text: string; readonly stack: string | null }

function field(value: object, name: string): unknown {
  return (value as Record<string, unknown>)[name];
}

function describe(value: unknown): Described {
  if (typeof value === 'string') return { text: value, stack: null };
  if (typeof value !== 'object' || value === null) return { text: String(value), stack: null };
  if (Array.isArray(value)) return { text: `[array of ${value.length}]`, stack: null };
  const message: unknown = field(value, 'message');
  if (typeof message === 'string') {
    const name: unknown = field(value, 'name');
    const stack: unknown = field(value, 'stack');
    const filename: unknown = field(value, 'filename');
    const where: string = typeof filename === 'string' && filename !== ''
      ? ` (${filename}:${String(field(value, 'lineno'))}:${String(field(value, 'colno'))})` : '';
    const prefix: string = typeof name === 'string' && name !== '' ? `${name}: ` : '';
    return { text: `${prefix}${message}${where}`, stack: typeof stack === 'string' ? stack : null };
  }
  // main.tsx's rejection handler logs `{ reason, promise }`: the reason is the line.
  if ('reason' in value) return describe(field(value, 'reason'));
  return { text: '[object]', stack: null };
}

/** `text` within `budget` UTF-8 bytes; when cut, the last (possibly partial) word goes too. */
export function cut(text: string, budget: number): string {
  // A UTF-16 string never has more code units than its UTF-8 encoding has bytes.
  if (text.length <= budget && encoder.encode(text).length <= budget) return text;
  const room: number = budget - encoder.encode(CUT_MARK).length;
  let kept: string = '';
  let bytes: number = 0;
  for (const ch of text) {
    const size: number = encoder.encode(ch).length;
    if (bytes + size > room) break;
    kept += ch;
    bytes += size;
  }
  return `${kept.replace(/\S*$/u, '').trimEnd()}${CUT_MARK}`;
}

function sourceOf(level: ConsoleLevel, first: unknown): BrowserConsoleSource {
  if (first === WINDOW_ERROR_TAG) return 'WindowError';
  if (first === REJECTION_TAG) return 'UnhandledRejection';
  return level === 'warn' ? 'ConsoleWarn' : 'ConsoleError';
}

export function lineFrom(level: ConsoleLevel, args: readonly unknown[]): ConsoleLine {
  const source: BrowserConsoleSource = sourceOf(level, args[0]);
  const logged: readonly unknown[] = source === 'WindowError' || source === 'UnhandledRejection' ? args.slice(1) : args;
  const parts: Described[] = logged.map(describe);
  const stack: string | null = parts.find((part: Described): boolean => part.stack !== null)?.stack ?? null;
  return {
    source,
    message: cut(parts.map((part: Described): string => part.text).join(' '), MESSAGE_BYTES),
    stack: stack === null ? null : cut(stack, STACK_BYTES),
  };
}

export function fromExtension(line: ConsoleLine): boolean {
  const text: string = `${line.message}\n${line.stack ?? ''}`.toLowerCase();
  return EXTENSION_MARKERS.some((marker: string): boolean => text.includes(marker));
}
