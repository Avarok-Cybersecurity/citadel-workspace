/**
 * The hosted server names the relying party every security-key ceremony runs
 * under (wrangler.toml PQ_SECURITY_KEY_RP_ID), and a key enrolled under one ID
 * never signs in under another. Every key so far was enrolled under the ID this
 * UI resolves on work.avarok.net and its tenant subdomains, so the deployed
 * value must be that one. Read from the deploy config itself, as wrangler reads it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCTION_RP_ID, resolveRpId } from '../rp-id';

const WRANGLER: string = readFileSync(join(process.cwd(), '..', 'deploy', 'tenant-worker', 'wrangler.toml'), 'utf8');

function deployed(toml: string): string[] {
  return [...toml.matchAll(/^PQ_SECURITY_KEY_RP_ID\s*=\s*"([^"]*)"\s*$/gm)].map((m: RegExpMatchArray) => m[1]);
}

describe('the hosted relying party', () => {
  it('is deployed once, as the ID this UI enrolled every key under', () => {
    expect(deployed(WRANGLER)).toEqual([PRODUCTION_RP_ID]);
  });

  it('is what this UI resolves on the control host and on a tenant subdomain', () => {
    expect(resolveRpId('work.avarok.net')).toBe(PRODUCTION_RP_ID);
    expect(resolveRpId('acme.work.avarok.net')).toBe(PRODUCTION_RP_ID);
  });

  it('would be caught if the deploy named another', () => {
    const changed: string = WRANGLER.replace(`PQ_SECURITY_KEY_RP_ID = "${PRODUCTION_RP_ID}"`, 'PQ_SECURITY_KEY_RP_ID = "avarok.net"');
    expect(changed).not.toBe(WRANGLER);
    expect(deployed(changed)).not.toEqual([PRODUCTION_RP_ID]);
  });
});
