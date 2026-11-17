/**
 * Every subscriber to a member list says which domain's list it wants.
 *
 * The workspace protocol carries no request id, so a `Members` response cannot
 * be attributed to the request that caused it. `is-for-domain.ts` was written
 * for four subscribers taking last-writer-wins — the sidebar, the admin members
 * tab, the user-search corpus and the group-call roster — and was applied to
 * two of them.
 *
 * The group-call roster was the sharpest miss, and its own header said so in
 * the wrong direction: "the event carries no domain id, so this is the
 * established contract, not an oversight of this hook". True when written,
 * false once the filter landed. Meanwhile another entity's ListMembers response
 * replaced the callable roster, so Start call rang THAT domain's members and
 * dropped this one's.
 *
 * A subscriber that genuinely wants every list has to say so here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Subscribers that deliberately take every list, and why.
 *
 * "Deliberately" means the subscriber is workspace-wide by design, not that
 * nobody has got round to it.
 */
const WORKSPACE_WIDE: Record<string, string> = {
  'components/hooks/useMemberEventSetup.ts':
    'builds the workspace-wide member record that user search and mentions read; ' +
    'scoping it to one domain would empty the corpus everywhere else',
};

describe('a members:loaded subscriber', () => {
  it('filters by domain, or says why it does not', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const offenders: string[] = [];

    for (const rel of files) {
      if (rel in WORKSPACE_WIDE) continue;
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));

      // Subscribing, not declaring or emitting. The type map names the event
      // and the response handler emits it; neither consumes a list.
      const subscribes: boolean =
        /on(?:Member)?Event(?:<[^>]*>)?\(\s*['"]members:loaded['"]/.test(source) ||
        /useEventListeners?(?:<[^>]*>)?\([^)]*['"]members:loaded['"]/.test(source) ||
        /eventEmitter\.(?:on|once)(?:<[^>]*>)?\(\s*['"]members:loaded['"]/.test(source);
      if (!subscribes) continue;
      if (/\bisForDomain\s*\(/.test(source)) continue;

      offenders.push(rel);
    }

    expect(
      offenders,
      'this adopts any member list that arrives, so a list fetched for another ' +
        'entity replaces it. Call isForDomain(payload.domainId, yourDomainId), ' +
        'or add the file to WORKSPACE_WIDE with why it wants every list.',
    ).toEqual([]);
  });

  it('keeps every exemption honest', () => {
    for (const rel of Object.keys(WORKSPACE_WIDE)) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      expect(
        /['"]members:loaded['"]/.test(source),
        `${rel} is exempted but no longer subscribes — drop the exemption ` +
          `rather than letting it shield a future one`,
      ).toBe(true);
    }
  });
});
