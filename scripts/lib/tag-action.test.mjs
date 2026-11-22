import { test } from "node:test";
import assert from "node:assert/strict";
import { tagAction } from "./tag-action.mjs";

const TAG = "agent-v0.14.1";
const HERE = "a".repeat(40);
const THERE = "b".repeat(40);

test("no tag is created; a tag already here is kept", () => {
  assert.equal(tagAction({ tag: TAG, sha: HERE, existing: null, release: null }).action, "create");
  assert.equal(tagAction({ tag: TAG, sha: HERE, existing: HERE, release: { draft: false } }).action, "keep");
});

test("a tag a failed release left at another commit is moved, naming the old commit", () => {
  const d = tagAction({ tag: TAG, sha: HERE, existing: THERE, release: null });
  assert.equal(d.action, "move");
  assert.match(d.message, new RegExp(`left at ${THERE}.*moved to ${HERE}`));
  assert.equal(tagAction({ tag: TAG, sha: HERE, existing: THERE, release: { draft: true } }).action, "move");
});

test("negative control: a released tag at another commit is refused", () => {
  const d = tagAction({ tag: TAG, sha: HERE, existing: THERE, release: { draft: false } });
  assert.equal(d.action, "refuse");
  assert.match(d.message, /is released at b+, not a+/);
});

test("malformed facts fail instead of guessing", () => {
  assert.throws(() => tagAction({ tag: "v0.14.1", sha: HERE, existing: null, release: null }), /agent-vX.Y.Z/);
  assert.throws(() => tagAction({ tag: TAG, sha: "abc", existing: null, release: null }), /full commit id/);
  assert.throws(() => tagAction({ tag: TAG, sha: HERE, existing: "tagobject", release: null }), /not a commit id/);
  assert.throws(() => tagAction({ tag: TAG, sha: HERE, existing: THERE }), /not looked up/);
});
