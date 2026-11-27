/**
 * The control plane re-scans a report with the client's own shapes (deploy/tenant-worker/control/
 * bug-report-scan.mjs). The two lists may not drift: the server would refuse what the client let
 * through (a report nobody can send), or store what the client would have removed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REDACTION_RULES, type RedactionRule } from '../redact';

const SERVER: string = resolve(__dirname, '../../../../../deploy/tenant-worker/control/bug-report-scan.mjs');

function serverRules(): { name: string; source: string }[] {
  const text: string = readFileSync(SERVER, 'utf-8');
  return [...text.matchAll(/\{ name: "([a-z]+)", source: String\.raw`((?:[^`\\]|\\.)*)` \}/gu)].map((m: RegExpMatchArray) => ({ name: m[1], source: m[2] }));
}

describe('the server scan', () => {
  it('has exactly the client\'s redaction shapes, in order', () => {
    const server: { name: string; source: string }[] = serverRules();
    expect(server.length).toBeGreaterThan(0);
    expect(server).toEqual(REDACTION_RULES.map((rule: RedactionRule) => ({ name: rule.name, source: rule.source })));
  });
});
