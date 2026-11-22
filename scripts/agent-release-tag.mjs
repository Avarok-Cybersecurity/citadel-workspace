#!/usr/bin/env node
// deploy.yml's plan job: put the agent-vX.Y.Z tag at the commit being deployed, so the release
// builds that commit. lib/tag-action.mjs decides keep / create / move / refuse and says why a
// tag left by a failed release is moved rather than refused.
//
//   TAG=agent-v0.15.1 SHA=<40 hex> GH_TOKEN=... GITHUB_REPOSITORY=owner/name node scripts/agent-release-tag.mjs
//
// All four are required. The token needs contents: write.
import { execFileSync } from "node:child_process";
import { tagAction } from "./lib/tag-action.mjs";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function gh(args) {
  return execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", ...args], {
    encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The API's JSON, or null on a 404 (and only on a 404). */
function read(path) {
  try {
    return JSON.parse(gh([path]));
  } catch (error) {
    if (/HTTP 404/.test(String(error.stderr))) return null;
    throw new Error(`gh api ${path}: ${String(error.stderr || error.message).split("\n")[0]}`);
  }
}

/** The commit a tag ref names, through an annotated tag object if it is one. */
function taggedCommit(repo, tag) {
  const ref = read(`repos/${repo}/git/ref/tags/${tag}`);
  if (ref === null) return null;
  if (ref.object.type === "commit") return ref.object.sha;
  if (ref.object.type === "tag") return read(`repos/${repo}/git/tags/${ref.object.sha}`).object.sha;
  throw new Error(`${tag} names a ${ref.object.type}, not a commit`);
}

let decision;
let facts;
try {
  const repo = env("GITHUB_REPOSITORY");
  env("GH_TOKEN");
  const tag = env("TAG");
  facts = { repo, tag, sha: env("SHA"), existing: taggedCommit(repo, tag), release: read(`repos/${repo}/releases/tags/${tag}`) };
  decision = tagAction(facts);
  if (decision.action === "create") gh(["-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${facts.sha}`]);
  if (decision.action === "move") gh(["-X", "PATCH", `repos/${repo}/git/refs/tags/${tag}`, "-f", `sha=${facts.sha}`, "-F", "force=true"]);
} catch (error) {
  console.error(`::error::the release tag could not be placed: ${error.message}`);
  process.exit(1);
}
if (decision.action === "refuse") {
  console.error(`::error::${decision.message}`);
  process.exit(1);
}
console.log(decision.action === "move" ? `::notice::${decision.message}` : decision.message);
