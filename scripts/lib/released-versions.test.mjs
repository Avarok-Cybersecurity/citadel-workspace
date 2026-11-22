import { test } from "node:test";
import assert from "node:assert/strict";
import { releasedVersions } from "./released-versions.mjs";

const rel = (tag_name, over = {}) => ({ tag_name, draft: false, prerelease: false, ...over });

test("the newest published release is the latest, not the newest tag", () => {
  // The repository on 2026-11-22: 0.14.0 and 0.14.1 were tagged, their builds failed, no release.
  const tags = ["agent-v0.14.2", "agent-v0.14.1", "agent-v0.14.0", "agent-v0.13.1", "agent-v0.12.1", "agent-v0.12.0"];
  const releases = [rel("agent-v0.14.2"), rel("agent-v0.13.1"), rel("agent-v0.12.1")];
  assert.deepEqual(releasedVersions(tags, releases), {
    latestTag: "agent-v0.14.2",
    latestReleased: "0.14.2",
    orphans: ["agent-v0.14.1", "agent-v0.14.0", "agent-v0.12.0"],
  });
});

test("negative control: a failed release's tag at the crate's version is not released", () => {
  const d = releasedVersions(["agent-v0.14.1", "agent-v0.13.1"], [rel("agent-v0.13.1")]);
  assert.equal(d.latestReleased, "0.13.1");
  assert.deepEqual(d.orphans, ["agent-v0.14.1"]);
});

test("drafts and prereleases are not released; a release without its tag does not count", () => {
  const d = releasedVersions(
    ["agent-v0.3.0", "agent-v0.2.0", "agent-v0.1.0"],
    [rel("agent-v0.3.0", { draft: true }), rel("agent-v0.2.0", { prerelease: true }), rel("agent-v0.1.0"), rel("agent-v9.9.9")],
  );
  assert.equal(d.latestTag, "agent-v0.1.0");
  assert.deepEqual(d.orphans, ["agent-v0.3.0", "agent-v0.2.0"]);
});

test("versions order numerically, and other tags and releases are ignored", () => {
  const d = releasedVersions(["agent-v0.9.0", "agent-v0.10.0", "ui-v1.0.0"], [rel("agent-v0.9.0"), rel("agent-v0.10.0"), rel("ui-v1.0.0")]);
  assert.equal(d.latestReleased, "0.10.0");
  assert.deepEqual(d.orphans, []);
});

test("nothing released is null, and a missing list fails", () => {
  assert.deepEqual(releasedVersions([], []), { latestTag: null, latestReleased: null, orphans: [] });
  assert.throws(() => releasedVersions(["agent-v0.1.0"], undefined), /both be lists/);
});
