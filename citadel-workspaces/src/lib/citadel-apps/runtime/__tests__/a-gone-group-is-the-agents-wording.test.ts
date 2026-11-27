/**
 * topic-admission.ts knows a join met a group the server no longer has only by the agent's words
 * for it (`GroupRequestJoinFailure` carries no other sign). If the agent's wording changed, every
 * ended topic group would read as an owner who has not answered, and the member who should host
 * the topic would wait for nobody, with nothing here to notice.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GROUP_GONE } from '../topic-admission';

const JOIN: string = resolve(__dirname, '../../../../../../citadel-internal-service/citadel-internal-service/src/kernel/requests/group/request_join.rs');

describe("the agent's word for a group that is gone", () => {
  it('is the wording the agent sends', () => {
    const said: RegExpExecArray | null = /JoinOutcome::GroupGone => Err\("([^"]+)"/.exec(readFileSync(JOIN, 'utf8'));
    expect(said?.[1]).toBe(GROUP_GONE);
  });
});
