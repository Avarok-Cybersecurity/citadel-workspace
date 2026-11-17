/**
 * tell-preferences.ts recognises the agent's ownership refusal by its wording. If the agent's
 * wording changed, every reload would log the error again and nothing here would notice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OWNERSHIP_REFUSAL } from '../tell-preferences';

const GATE: string = resolve(__dirname, '../../../../../citadel-internal-service/citadel-internal-service/src/kernel/requests/mod.rs');

describe("the agent's ownership refusal", () => {
  it('is the wording the agent sends', () => {
    const declared: RegExpExecArray | null = /const REFUSED: &str = "([^"]+)";/.exec(readFileSync(GATE, 'utf8'));
    expect(declared?.[1]).toBe(OWNERSHIP_REFUSAL);
  });
});
