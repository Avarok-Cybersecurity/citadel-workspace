// The agent's slice of Cargo.lock: the packages its build can reach, and nothing else.
//
// The agent release check diffed the whole Cargo.lock, so a dependency added to the workspace
// server (base64, 2026-09-27) read as "the agent changed" and demanded a version bump -- a new
// download identical to the last one. Only the entries the agent's build resolves matter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lockClosure } from "./lock-closure.mjs";

const LOCK = `
version = 4

[[package]]
name = "agent"
version = "0.8.0"
dependencies = [
 "serde",
 "base64 0.21.7",
]

[[package]]
name = "base64"
version = "0.21.7"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "aaa"

[[package]]
name = "base64"
version = "0.22.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "bbb"

[[package]]
name = "kernel"
version = "0.1.0"
dependencies = [
 "base64 0.22.1",
 "serde",
]

[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "ccc"
dependencies = [
 "serde_derive",
]

[[package]]
name = "serde_derive"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "ddd"
`;

test("the closure holds what the root reaches, pinned by version and checksum", () => {
  assert.deepEqual(lockClosure(LOCK, "agent"), [
    "agent 0.8.0  ",
    "base64 0.21.7 registry+https://github.com/rust-lang/crates.io-index aaa",
    "serde 1.0.0 registry+https://github.com/rust-lang/crates.io-index ccc",
    "serde_derive 1.0.0 registry+https://github.com/rust-lang/crates.io-index ddd",
  ]);
});

test("a dependency added to another crate leaves the agent's closure unchanged", () => {
  const added = LOCK.replace(' "base64 0.22.1",\n "serde",', ' "base64 0.22.1",\n "serde",\n "tokio",') +
    '\n[[package]]\nname = "tokio"\nversion = "1.0.0"\nsource = "registry+x"\nchecksum = "eee"\n';
  assert.deepEqual(lockClosure(added, "agent"), lockClosure(LOCK, "agent"));
});

test("a version change inside the agent's closure changes it", () => {
  const bumped = LOCK.replace('name = "serde_derive"\nversion = "1.0.0"', 'name = "serde_derive"\nversion = "1.0.1"')
    .replace(' "serde_derive",', ' "serde_derive",');
  assert.notDeepEqual(lockClosure(bumped, "agent"), lockClosure(LOCK, "agent"));
});

test("a root the lock does not hold is an error, not an empty closure", () => {
  assert.throws(() => lockClosure(LOCK, "nobody"), /nobody/);
});
