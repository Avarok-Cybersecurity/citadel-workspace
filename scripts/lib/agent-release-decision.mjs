// Whether the agent people download matches the agent this commit builds. Pure: every input is
// passed in, so the table below is the whole rule (see agent-release-state.mjs for the I/O).
//
//   released       the latest release is this version and nothing it is built from changed
//   needs-release  this version has no release yet; deploying must publish it first
//   needs-bump     the agent changed since its release but still claims that release's version
//
// A site deployed ahead of its agent is what let the download sit at v0.7.0 while the site ran two
// days of agent fixes: every check passed on a locally built agent nobody could download.

/** "1.2.3" -> [1, 2, 3]; anything else throws, so a malformed version fails the deploy loudly. */
export function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`not a MAJOR.MINOR.PATCH version: ${JSON.stringify(version)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * @param {{ version: string, latestReleased: string | null, changedSinceLatest: boolean }} input
 *   version: the crate's version; latestReleased: the newest agent-v* tag's version, null if none;
 *   changedSinceLatest: whether any agent input differs between that tag and this commit.
 */
export function decide({ version, latestReleased, changedSinceLatest }) {
  if (latestReleased === null) return { state: "needs-release", reason: `no agent has been released; ${version} will be the first` };
  const order = compare(version, latestReleased);
  if (order < 0) throw new Error(`the agent's version ${version} is older than the released ${latestReleased}`);
  if (order > 0) return { state: "needs-release", reason: `${version} is newer than the released ${latestReleased}` };
  return changedSinceLatest
    ? { state: "needs-bump", reason: `the agent changed since agent-v${version} was released, but its version is still ${version}: bump citadel-workspace-internal-service/Cargo.toml` }
    : { state: "released", reason: `agent-v${version} is released and nothing it is built from has changed` };
}
