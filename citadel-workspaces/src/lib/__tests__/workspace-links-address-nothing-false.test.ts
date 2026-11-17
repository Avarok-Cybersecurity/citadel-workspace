/**
 * A workspace link must not claim to identify a workspace it cannot identify.
 *
 * Every path this module built carried `?id=<activeWorkspaceId>`. Nothing read
 * that parameter — the only ones anything in the app reads are `nodeId`,
 * `section`, `showP2P`, `channel`, `p2pUser` and `join` — and its value was
 * always the literal `'root'`, because `setActiveWorkspaceId` had no callers.
 * Both ends of the feature were absent; only the URL pollution was real.
 *
 * That made shared links actively wrong: `/workspace?id=root&nodeId=…` looks
 * like it addresses a specific workspace, so pasting one to a colleague in a
 * DIFFERENT workspace opened THEIR workspace with your node id.
 */
import { describe, it, expect } from 'vitest';
import { getWorkspacePath, buildWorkspacePath } from '../workspace-navigation';

describe('a workspace path', () => {
  it('carries no id parameter', () => {
    expect(getWorkspacePath()).toBe('/workspace');
    expect(getWorkspacePath({ nodeId: 'n1' })).not.toMatch(/[?&]id=/);
  });

  it('keeps the parameters that are actually read', () => {
    const path: string = getWorkspacePath({ nodeId: 'n1', section: 'files' });

    expect(path).toMatch(/nodeId=n1/);
    expect(path).toMatch(/section=files/);
  });

  it('strips a stale id from a link shared before this was removed', () => {
    const shared: URLSearchParams = new URLSearchParams('id=root&nodeId=n1');

    const path: string = buildWorkspacePath(shared);

    expect(path).not.toMatch(/[?&]id=/);
    expect(path).toMatch(/nodeId=n1/);
  });

  it('produces a bare route when there is nothing to carry', () => {
    // Not "/workspace?" with a dangling separator.
    expect(buildWorkspacePath(new URLSearchParams())).toBe('/workspace');
  });
});
