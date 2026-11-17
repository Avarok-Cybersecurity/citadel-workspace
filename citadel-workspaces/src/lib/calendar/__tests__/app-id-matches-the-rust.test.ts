/** The id the Calendar is registered under is the one the server provisions as the default tab. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { glueTab } from '@/lib/citadel-apps/first-party/registry';
import { CALENDAR_APP_ID } from '../app-id';

const RUST: string = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../citadel-workspace-types/src/node_tabs.rs');

describe("the Calendar's app id", () => {
  it('is the default tab the server provisions, and the registry mounts it', () => {
    const provisioned: string | undefined = /pub const PROVISIONED_DEFAULT_APP_TABS: [^=]+= &\[([^\]]*)\];/.exec(readFileSync(RUST, 'utf8'))?.[1];
    expect(provisioned?.split(',').map((s: string) => s.trim().replace(/^"|"$/g, ''))).toContain(CALENDAR_APP_ID);
    expect(glueTab(CALENDAR_APP_ID)).not.toBeNull();
  });
});
