// Which agent versions are RELEASED: an agent-v* tag with a published (not draft, not
// prerelease) GitHub release. Pure: agent-release-state.mjs passes the tags and the releases in.
//
// A tag is not a release. deploy.yml's plan job creates agent-vX.Y.Z BEFORE release-agent.yml
// builds it, so when the build fails the tag stays and no release exists: agent-v0.14.0 and
// agent-v0.14.1 are such tags (runs 44939018558 and 44958340345), and the release list goes
// 0.13.1 -> 0.14.2. Reading the newest TAG as "latest released" made a re-run at the same version
// read `released`, skip the release, and deploy a site whose version.json names an agent nobody
// can download. Prereleases are excluded because /releases/latest/download, which the UI links,
// never serves one.
import { compareVersions } from "./agent-release-decision.mjs";

const AGENT_TAG = /^agent-v(\d+\.\d+\.\d+)$/;

/**
 * @param {string[]} tags  the repository's agent-v* tags
 * @param {{ tag_name: string, draft: boolean, prerelease: boolean }[]} releases  its GitHub releases
 * @returns {{ latestTag: string | null, latestReleased: string | null, orphans: string[] }}
 *   orphans: tags with no published release, newest first (left behind by a failed release).
 */
export function releasedVersions(tags, releases) {
  if (!Array.isArray(tags) || !Array.isArray(releases)) throw new Error("tags and releases must both be lists");
  const published = new Set(releases.filter((r) => r.draft === false && r.prerelease === false).map((r) => r.tag_name));
  const agent = tags.filter((t) => AGENT_TAG.test(t));
  const newestFirst = (a, b) => compareVersions(AGENT_TAG.exec(b)[1], AGENT_TAG.exec(a)[1]);
  const released = agent.filter((t) => published.has(t)).sort(newestFirst);
  const latestTag = released[0] ?? null;
  return {
    latestTag,
    latestReleased: latestTag ? AGENT_TAG.exec(latestTag)[1] : null,
    orphans: agent.filter((t) => !published.has(t)).sort(newestFirst),
  };
}
