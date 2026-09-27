#!/usr/bin/env node
// Is the downloadable agent in step with this commit? Prints the decision (see
// lib/agent-release-decision.mjs) and, on GitHub Actions, writes state/version/tag outputs.
//
//   node scripts/agent-release-state.mjs            report only
//   node scripts/agent-release-state.mjs --pr       fail on needs-bump (a PR must bump the version)
//
// Needs the agent-v* tags: CI checks out with fetch-depth 0 (tags included).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { decide } from "./lib/agent-release-decision.mjs";

const MANIFEST = "citadel-workspace-internal-service/Cargo.toml";

// Everything the released agent is built from (.github/workflows/release-agent.yml and the actions
// it runs). A change to any of these is a change to what people download.
export const AGENT_INPUTS = [
  "citadel-workspace-internal-service",
  "citadel-internal-service", // the submodule: its pointer is the agent's source
  "Cargo.lock",
  "Cargo.toml",
  "apps/macos-agent",
  "packaging",
  "scripts/build-macos-agent-app.sh",
  "scripts/package-linux-agent.sh",
  "scripts/release-version.sh",
  "scripts/lib/assert-agent-version.sh",
  ".github/workflows/release-agent.yml",
  ".github/actions/build-agent",
  ".github/actions/agent-certificate",
  ".github/actions/macos-agent-app",
  ".github/actions/macos-agent-dmg",
  ".github/actions/linux-agent-packages",
  ".github/actions/windows-agent-msi",
  ".github/actions/publish-agent-release",
];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function crateVersion() {
  const toml = readFileSync(MANIFEST, "utf8");
  const pkg = /^\[package\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(toml);
  const m = pkg && /^version\s*=\s*"([^"]+)"/m.exec(pkg[1]);
  if (!m) throw new Error(`${MANIFEST} has no [package] version`);
  return m[1];
}

const version = crateVersion();
const tags = git("tag", "-l", "agent-v*", "--sort=-v:refname").split("\n").filter(Boolean);
const latestTag = tags[0] ?? null;
const latestReleased = latestTag ? latestTag.slice("agent-v".length) : null;
let changedSinceLatest = true;
if (latestTag) {
  try {
    execFileSync("git", ["diff", "--quiet", latestTag, "HEAD", "--", ...AGENT_INPUTS]);
    changedSinceLatest = false;
  } catch (err) {
    if (err.status !== 1) throw err; // 1 = differences; anything else is a real failure
  }
}

const d = decide({ version, latestReleased, changedSinceLatest });
console.log(`agent: crate ${version}, latest release ${latestTag ?? "(none)"}, inputs changed since it: ${changedSinceLatest} (examined ${AGENT_INPUTS.length} paths)`);
console.log(`agent: ${d.state} -- ${d.reason}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `state=${d.state}\nversion=${version}\ntag=agent-v${version}\n`);
}
if (process.argv.includes("--pr") && d.state === "needs-bump") {
  console.error(`::error::${d.reason}`);
  process.exit(1);
}
