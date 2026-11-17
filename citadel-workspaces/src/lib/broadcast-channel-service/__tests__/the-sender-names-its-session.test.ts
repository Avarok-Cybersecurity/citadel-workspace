import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
describe('the sender stamps the session', () => {
  it('passes the selected cid to broadcastStateSync', () => {
    const src: string = readFileSync(join(process.cwd(), 'src/lib/broadcast-channel-service/service.ts'), 'utf8');
    const at: number = src.indexOf('public broadcastStateSync');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 600), 'state-sync is broadcast without naming its session, so the gate has nothing to compare').toMatch(/selectedCid/);
  });
});
