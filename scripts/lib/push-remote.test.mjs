import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBranchOf, pushRemote, repoIdentity } from './push-remote.mjs';

const remotes = [
  { name: 'origin', urls: ['git@github.com:Avarok-Cybersecurity/citadel-workspace.git'] },
  { name: 'fork', urls: ['https://github.com/someone/citadel-workspace.git', 'git@github.com:someone/citadel-workspace.git'] },
];

test('ssh, scp-style and https spellings of one repository are one identity', () => {
  const id = 'github.com/Avarok-Cybersecurity/citadel-workspace';
  for (const url of ['git@github.com:Avarok-Cybersecurity/citadel-workspace.git', 'https://github.com/Avarok-Cybersecurity/citadel-workspace.git',
    'https://x-access-token@GitHub.com/Avarok-Cybersecurity/citadel-workspace/', 'ssh://git@github.com:22/Avarok-Cybersecurity/citadel-workspace']) {
    assert.equal(repoIdentity(url), id, url);
  }
  assert.notEqual(repoIdentity('https://github.com/someone/citadel-workspace.git'), id);
});

test('a remote name is used as it is', () => {
  assert.deepEqual(pushRemote('fork', remotes), { remote: 'fork', how: 'named' });
});

test('a URL resolves to the remote whose url or pushurl is that repository', () => {
  assert.equal(pushRemote('https://github.com/Avarok-Cybersecurity/citadel-workspace.git', remotes).remote, 'origin');
  assert.equal(pushRemote('https://github.com/someone/citadel-workspace', remotes).remote, 'fork');
});

test('a URL no remote points at is judged against origin\'s refs; without origin it fails naming the fix', () => {
  assert.equal(pushRemote('https://example.com/elsewhere.git', remotes).remote, 'origin');
  assert.throws(() => pushRemote('https://example.com/elsewhere.git', [remotes[1]]), /fix: git remote add origin/);
});

test('a remote without a recorded default branch falls back to origin\'s, else fails naming the fix', () => {
  const heads = new Map([['origin', 'refs/remotes/origin/master'], ['fork', null]]);
  assert.equal(defaultBranchOf('fork', heads), 'refs/remotes/origin/master');
  assert.equal(defaultBranchOf('origin', heads), 'refs/remotes/origin/master');
  assert.throws(() => defaultBranchOf('fork', new Map([['fork', null], ['origin', null]])), /fix: git remote set-head fork --auto/);
});
