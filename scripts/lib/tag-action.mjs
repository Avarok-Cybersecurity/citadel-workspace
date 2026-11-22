// What deploy.yml's plan job does with the agent-vX.Y.Z tag before releasing it. Pure: the
// facts come from scripts/agent-release-tag.mjs.
//
//   keep    the tag is already at this commit (a re-run)
//   create  there is no tag yet
//   move    the tag is at another commit and has NO published release: a release that failed
//           after the tag was made (agent-v0.14.0, agent-v0.14.1: runs 44939018558, 44958340345)
//   refuse  the tag is at another commit WITH a release: that agent is out, and moving its tag
//           would change what its download claims to be built from
//
// The old step refused every tag at another commit, so a failed release could only be retried
// by deleting its tag by hand; reading tags as releases (fixed in released-versions.mjs) had
// hidden that by skipping the retry altogether.

const SHA = /^[0-9a-f]{40}$/;
const TAG = /^agent-v\d+\.\d+\.\d+$/;

/**
 * @param {{ tag: string, sha: string, existing: string | null,
 *   release: { draft: boolean } | null }} facts
 *   existing: the commit the tag points at now, null if absent; release: the tag's GitHub
 *   release, null if none.
 */
export function tagAction({ tag, sha, existing, release }) {
  if (!TAG.test(tag ?? "")) throw new Error(`${JSON.stringify(tag)} is not an agent-vX.Y.Z tag`);
  if (!SHA.test(sha ?? "")) throw new Error(`${JSON.stringify(sha)} is not a full commit id`);
  if (existing !== null && !SHA.test(existing)) throw new Error(`${tag} points at ${JSON.stringify(existing)}, not a commit id`);
  if (release === undefined) throw new Error(`whether ${tag} has a release was not looked up`);
  if (existing === null) return { action: "create", message: `created ${tag} at ${sha}` };
  if (existing === sha) return { action: "keep", message: `${tag} already at ${sha}` };
  if (release !== null && release.draft !== true) {
    return { action: "refuse", message: `${tag} is released at ${existing}, not ${sha}: bump the agent's version instead of moving a released tag` };
  }
  return {
    action: "move",
    message: `${tag} was left at ${existing} by a release that never published; moved to ${sha}`,
  };
}
