/**
 * DOCUMENTS_RELAY_LIMITS mirrors the kernel's `[documents]` table; this reads the parent's
 * kernel.toml (CI checks the parent out around this repository, as the parent's own checkout
 * does locally) and fails when the two disagree.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCUMENTS_RELAY_LIMITS } from '../relay-limits';

function documentsTable(toml: string): Map<string, number> {
  const start: number = toml.indexOf('\n[documents]');
  if (start < 0) throw new Error('kernel.toml has no [documents] table');
  const body: string = toml.slice(start + '\n[documents]'.length).split(/\n\[/)[0];
  const keys: Map<string, number> = new Map<string, number>();
  for (const line of body.split('\n')) {
    const match: RegExpMatchArray | null = /^\s*([a-z_]+)\s*=\s*(\d+)\s*$/.exec(line);
    if (match) keys.set(match[1], Number(match[2]));
  }
  return keys;
}

describe('the relay limits this client respects', () => {
  it('are the kernel\'s configured [documents] limits', () => {
    const table: Map<string, number> = documentsTable(readFileSync(join(process.cwd(), '..', 'docker', 'workspace-server', 'kernel.toml'), 'utf8'));
    expect({
      maxUpdateBytes: table.get('max_update_bytes'),
      maxSnapshotBytes: table.get('max_snapshot_bytes'),
      maxAwarenessBytes: table.get('max_awareness_bytes'),
      awarenessPerSecond: table.get('awareness_per_second'),
      appendsPerSecond: table.get('appends_per_second'),
      pullsPerSecond: table.get('pulls_per_second'),
    }).toEqual(DOCUMENTS_RELAY_LIMITS);
  });
});
