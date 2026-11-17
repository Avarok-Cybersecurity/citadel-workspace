/**
 * Every zone this runtime's `Intl` offers (what the Calendar's zone question lists, and what a
 * browser reports for its device) is one the server accepts as a node's or workspace's
 * `time_zone` (citadel-workspace-types/src/time_zones.rs), links such as Europe/Amsterdam included.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RUST: string = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../citadel-workspace-types/src/time_zones.rs');

function serverZones(): ReadonlySet<string> {
  const table: string | undefined = /const TIME_ZONE_TABLE: &str = "\\\n([\s\S]*?)";/.exec(readFileSync(RUST, 'utf8'))?.[1];
  if (table === undefined) throw new Error('time_zones.rs no longer holds TIME_ZONE_TABLE');
  return new Set(table.replace(/\\\n/g, ' ').split(/\s+/).filter((n: string) => n !== ''));
}

describe('the zones a browser offers', () => {
  it('are all accepted by the server', () => {
    const accepted: ReadonlySet<string> = serverZones();
    expect(Intl.supportedValuesOf('timeZone').filter((zone: string) => !accepted.has(zone))).toEqual([]);
  });

  it('include the links a browser reports, which zone1970.tab leaves out', () => {
    const accepted: ReadonlySet<string> = serverZones();
    for (const link of ['Europe/Amsterdam', 'Asia/Calcutta', 'Europe/Kiev', 'UTC']) expect(accepted.has(link), link).toBe(true);
  });
});
