import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, parseVersion } from "./agent-release-decision.mjs";

test("a version with no release yet needs one", () => {
  assert.equal(decide({ version: "0.8.0", latestReleased: "0.7.0", changedSinceLatest: true }).state, "needs-release");
  assert.equal(decide({ version: "0.1.0", latestReleased: null, changedSinceLatest: true }).state, "needs-release");
});

test("the released version, unchanged, is released", () => {
  assert.equal(decide({ version: "0.7.0", latestReleased: "0.7.0", changedSinceLatest: false }).state, "released");
});

test("an agent changed under a released version must be bumped", () => {
  const d = decide({ version: "0.7.0", latestReleased: "0.7.0", changedSinceLatest: true });
  assert.equal(d.state, "needs-bump");
  assert.match(d.reason, /bump/);
});

test("versions compare numerically, not as text", () => {
  assert.equal(decide({ version: "0.10.0", latestReleased: "0.9.0", changedSinceLatest: false }).state, "needs-release");
  assert.throws(() => decide({ version: "0.9.0", latestReleased: "0.10.0", changedSinceLatest: false }), /older/);
});

test("a malformed version fails instead of guessing", () => {
  assert.throws(() => parseVersion("0.8"), /MAJOR/);
  assert.throws(() => parseVersion("v0.8.0"), /MAJOR/);
});
