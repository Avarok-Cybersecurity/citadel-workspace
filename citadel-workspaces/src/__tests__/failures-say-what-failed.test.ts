/**
 * A catch that reports a fixed sentence throws away what the server said.
 *
 * This has now been the finding four separate times — the node delete path, the
 * admin member writes, the entity create/edit modal, and the add-peer form. In
 * each, `awaitWriteResponse` (or the transport) produced a precise rejection —
 * "Permission denied: EditTreeStructure required", "Cannot demote the only
 * administrator" — and the catch replaced it with "Please try again", sending
 * the real one to `debugLog`, which is compiled out of production builds.
 *
 * The user then cannot tell "you are not allowed to do this" from "the network
 * blipped", so they retry something that can never work.
 *
 * This scan is the fifth fix, and the last one: a catch that surfaces a message
 * to the user has to consult the error it caught, or say here why it does not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Catches whose user-facing message is deliberately fixed, and why.
 *
 * Every entry names a case where the caught error genuinely has nothing to tell
 * the user — not one where nobody got round to it.
 */
const DELIBERATELY_FIXED: Record<string, string> = {};

/**
 * Catches that still report a fixed sentence, listed rather than excused.
 *
 * The scan found twenty files, not the four the campaign had fixed one at a
 * time. Twelve were swept in the round that introduced this guard; these are
 * the remainder, each needing a judgement about what the user should actually
 * be told rather than a mechanical rewrite. Listed here so the guard is green,
 * the debt is enumerated, and a NEW one cannot be added quietly.
 */
const RECORDED_DEBT: Record<string, string> = {
  'hooks/use-group-state-invite.ts': 'invite accept/decline; needs a decision about partial failure',
  'lib/session-startup-sequence.ts': 'startup continues on failure by design; the message needs rethinking with it',
  'components/p2p/LiveDocumentModal.tsx': 'document create; inline error already shown, wording needs review',
  'components/login-session-redirect.ts': 'redirect failure; overlaps the retry modal',
  'components/chat/CreateGroupDialog.tsx': 'inline error already shown; wording needs review',
  'components/admin/tabs/GeneralTab.tsx': 'workspace rename; overlaps awaitWriteResponse messaging',
};

/** A user-facing failure report. */
const SURFACES: RegExp = /\b(toast|toastError|setError|setCreateError|setDeleteError|setRenderError)\s*\(/;

/**
 * Every catch in `rel` that reports a failure to the user without consulting it.
 */
function offendingCatches(rel: string): string[] {
  const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
  const found: string[] = [];

  // Each `catch (name) { ... }` body, delimited by matching braces.
  //
  // Taking the body as "everything up to the next catch" reads far past the
  // closing brace: WorkspaceInitializationModal's catch does nothing but log,
  // and the *success* toast four lines below it was being counted as that
  // catch's failure report. An over-reporting scan is not a safe one — it fills
  // the debt list with files that were never wrong.
  for (const match of source.matchAll(/catch\s*\((\w+)\)\s*\{/g)) {
    const name: string = match[1];
    const open: number = match.index + match[0].length - 1;
    let depth: number = 0;
    let close: number = source.length;
    for (let i: number = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) { close = i; break; }
    }
    const body: string = source.slice(match.index, close);
    if (!SURFACES.test(body)) continue;

    // The logging calls are stripped FIRST, and that is the whole point.
    //
    // My first version of this scan asked only whether the catch mentioned its
    // error anywhere — and passed its own negative control, because every one
    // of these defects does `debugLog('X', 'failed:', error)` beside the fixed
    // sentence. Logging the reason and showing the user something else IS the
    // defect; a rule satisfied by the logging call could never have caught any
    // of the four.
    const userFacing: string = body
      .replace(new RegExp(`catch\\s*\\(${name}\\)`), '')
      .replace(/\b(debugLog|console\.\w+)\s*\([^;]*\);/g, '');

    if (!new RegExp(`\\b${name}\\b`).test(userFacing)) {
      found.push(`${rel}: catch (${name}) reports a failure without consulting it`);
    }
  }

  return found;
}

describe('a caught failure', () => {
  it('tells the user what actually failed', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const offenders: string[] = [];

    for (const rel of files) {
      if (rel in DELIBERATELY_FIXED || rel in RECORDED_DEBT) continue;
      offenders.push(...offendingCatches(rel));
    }

    expect(
      offenders,
      'the server sends a reason and the user is shown "please try again" instead, ' +
        'so they retry something that can never work. Include the error message, ' +
        'or add the file to DELIBERATELY_FIXED with why the error has nothing to say.',
    ).toEqual([]);
  });

  it('keeps every exemption honest', async () => {
    for (const rel of [...Object.keys(DELIBERATELY_FIXED), ...Object.keys(RECORDED_DEBT)]) {
      expect(
        offendingCatches(rel).length,
        `${rel} is exempted but no longer has a catch that hides its error — drop ` +
          `the exemption rather than letting it shield a future one`,
      ).toBeGreaterThan(0);
    }
  });
});
