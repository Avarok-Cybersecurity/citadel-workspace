/**
 * Every MUTATING workspace request must wait for the server to accept it.
 *
 * `sendProtocolRequest` resolves when the frame reaches the local WASM sink, and
 * the server answers a refusal as a RESPONSE — which can never reject that
 * promise. `awaitWriteResponse` was built to fix exactly this, and was wired to
 * four of the eleven write types.
 *
 * The seven that were missed each had a UI that reported success anyway:
 * "Member Added — {username} has been added to the workspace as {role}" for a
 * username that does not exist; "Permissions saved successfully" with the modal
 * closed; the edit composer clearing the user's text while the message kept its
 * old content; "Every member will see this theme" for a theme nobody receives.
 *
 * This asserts on the SOURCE, because the property is "no write bypasses the
 * gate" — which no single call can demonstrate, and which is exactly the kind of
 * thing that regresses when someone adds the twelfth write.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR: string = join(process.cwd(), 'src/lib/workspace-service');

/**
 * Mutating request variants the client can actually issue.
 *
 * `MoveNode` is deliberately absent: the server implements it and the client
 * has a full response path for it, but there is no `moveNode` method and no
 * drag affordance — reorganising a workspace is not possible today. Asserting
 * it is gated would assert something about code that does not exist; it is
 * covered by the map test below instead, so the gate is ready when someone
 * wires the caller.
 */
const MUTATING: string[] = [
  'CreateNode', 'UpdateNode', 'DeleteNode',
  'AddMember', 'RemoveMember', 'UpdateMemberRole', 'UpdateMemberPermissions',
  'UpdateWorkspaceTheme', 'EditGroupMessage', 'DeleteGroupMessage',
  // Gated later than the rest and never added here, so the guard did not cover
  // them: the workspace rename, workspace creation, and the profile save whose
  // spinner disabled the entire settings form.
  'UpdateWorkspace', 'CreateWorkspace', 'UpdateUserProfile',
  // The group send, whose composer clears on resolve — an ungated one throws
  // the user's text away on any refusal.
  'SendGroupMessage',
  // "Members can see each other": the admin's switch shows the stored value.
  'SetMembersVisible',
];

/**
 * Comments stripped before matching, as the sibling guards in this suite already
 * do. Without it, commenting a call site out — `// return awaitWriteResponse(...)`
 * with a bare `sendProtocolRequest` beneath — keeps `toContain` satisfied while
 * the write is ungated again. This campaign has already produced one source
 * assertion that matched the comment explaining the code's removal.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sources: string = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => stripComments(readFileSync(join(DIR, f), 'utf8')))
  .join('\n');

describe('workspace writes', () => {
  it.each(MUTATING)('%s waits for the server to accept it', (variant) => {
    // Whitespace-tolerant: a call that needs extra arguments is written across
    // lines, and a guard that fails on formatting teaches people to reformat
    // rather than to gate.
    expect(sources).toMatch(
      new RegExp(`awaitWriteResponse\\(\\s*'${variant}'`),
    );
  });

  it('names every gated variant in the success-response map', () => {
    const map: string = readFileSync(join(DIR, 'await-write-response.ts'), 'utf8');
    // A variant wired at the call site but missing from the map falls through
    // the `if (!accepted)` early return and silently sends without waiting —
    // the same defect wearing the fix's clothes.
    for (const variant of [...MUTATING, 'MoveNode']) {
      expect(map, `${variant} is gated but has no success response`).toMatch(
        new RegExp(`\\b${variant}:\\s*\\[`)
      );
    }
  });
});
