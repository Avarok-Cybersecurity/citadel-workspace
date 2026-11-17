/**
 * The few facts the About tab prints that are not the updater's: what the greeting says
 * about the agent, which operating system it is on, and which build of the workspace page is
 * running. Each says "unknown" rather than inventing a value.
 */
import { describe, expect, it } from 'vitest';
import { readGreetingFacts } from '../agent-facts';
import { osLabel } from '../agent-os';
import { buildLabel } from '../workspace-build';
import { parseNotes, type NotesBlock } from '../parse-notes';

describe('the greeting\'s facts', () => {
  it('reads a version and an operating system when they are text', () => {
    expect(readGreetingFacts({ agent_version: '0.8.9', os: 'macos' })).toEqual({ version: '0.8.9', os: 'macos' });
  });
  it('reads nothing from an older agent, or from the wrong shape', () => {
    expect(readGreetingFacts({ cid: 0n })).toEqual({});
    expect(readGreetingFacts({ agent_version: 9, os: '' })).toEqual({});
  });
});

describe('the operating system line', () => {
  const nav = (platform: string, userAgent: string): Navigator => ({ platform, userAgent, maxTouchPoints: 0 }) as Navigator;
  it('prefers what the agent says, spelled for people', () => {
    expect(osLabel({ os: 'macos' }, nav('Win32', 'Windows'))).toBe('macOS');
    expect(osLabel({ os: 'windows' }, nav('MacIntel', 'Mac OS'))).toBe('Windows');
    expect(osLabel({ os: 'linux' }, nav('MacIntel', 'Mac OS'))).toBe('Linux');
  });
  it('otherwise reads this browser\'s platform, since the agent is on this machine', () => {
    expect(osLabel({}, nav('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'))).toBe('macOS');
    expect(osLabel({}, nav('Win32', 'Mozilla/5.0 (Windows NT 10.0)'))).toBe('Windows');
    expect(osLabel({}, nav('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)'))).toBe('Linux');
  });
  it('passes an operating system it does not know through as the agent wrote it, not as a guess', () => {
    expect(osLabel({ os: 'freebsd' }, nav('MacIntel', 'Mac OS'))).toBe('freebsd');
    expect(osLabel({}, nav('', ''))).toBe('Unknown');
  });
});

describe('the workspace build', () => {
  it('is the hash in the entry chunk\'s name', () => {
    expect(buildLabel('/assets/index-Ab12Cd34.js')).toBe('Ab12Cd34');
  });
  it('is a development build when there is no manifest', () => {
    expect(buildLabel(null)).toBe('development build');
  });
  it('shows an entry without a hash whole, rather than nothing', () => {
    expect(buildLabel('/assets/main.js')).toBe('main.js');
  });
});

describe('release notes', () => {
  it('splits headings, bullets and paragraphs, and keeps every character as text', () => {
    expect(parseNotes('## Fixes\n- one\n* two\n\nPlain **line**')).toEqual([
      { kind: 'heading', text: 'Fixes' },
      { kind: 'list', items: ['one', 'two'] },
      { kind: 'paragraph', text: 'Plain **line**' },
    ]);
  });
  it('treats markup as text, never as something to render', () => {
    const blocks: NotesBlock[] = parseNotes('<img src=x onerror=alert(1)>\n- <script>alert(2)</script>');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '<img src=x onerror=alert(1)>' },
      { kind: 'list', items: ['<script>alert(2)</script>'] },
    ]);
  });
  it('joins wrapped lines of one paragraph and handles Windows line endings', () => {
    expect(parseNotes('one\r\ntwo\r\n\r\nthree')).toEqual([{ kind: 'paragraph', text: 'one two' }, { kind: 'paragraph', text: 'three' }]);
  });
  it('is empty for nothing', () => {
    expect(parseNotes('  \n ')).toEqual([]);
  });
});
