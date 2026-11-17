/**
 * The Calendar's manifest (apps/first-party/calendar/manifest.json in the parent) lists exactly the
 * routes the Calendar serves: `calendarRoutes(engine)`, from the real engine. The kernel admits a
 * served route only if the install's grant lists it, so a route served and not listed is refused
 * at runtime, and one listed and not served is consent asked for nothing.
 *
 * The manifest exists only on parent revisions that carry the Calendar's install. Against one that
 * does not, this skips visibly, with the path, rather than passing.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Route } from '@/lib/citadel-apps/sdk/generated/Route';
import { calendarRoutes } from '../calendar-endpoint';
import { realEngine } from './engine-rig';

const MANIFEST: string = resolve(__dirname, '../../../../../apps/first-party/calendar/manifest.json');

interface CapabilityRequest { cap: string; routes?: string[] }

function servedInManifest(): string[] {
  const manifest: { capabilities: CapabilityRequest[] } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { capabilities: CapabilityRequest[] };
  const serve: CapabilityRequest | undefined = manifest.capabilities.find((c: CapabilityRequest) => c.cap === 'ihttp.serve');
  if (serve?.routes === undefined) throw new Error('the manifest asks for no ihttp.serve routes');
  return [...serve.routes].sort();
}

describe.skipIf(!existsSync(MANIFEST))(`the routes in ${MANIFEST}`, () => {
  it('are the routes the Calendar serves, each once', () => {
    const served: string[] = calendarRoutes(realEngine()).map((r: Route) => `${r.method} ${r.path}`).sort();
    expect(new Set(served).size).toBe(served.length);
    expect(servedInManifest()).toEqual(served);
  });
});
