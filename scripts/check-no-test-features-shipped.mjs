#!/usr/bin/env node
/**
 * No shipped binary may be built with a test-only cargo feature.
 *
 * `citadel-workspace-server-kernel/tests/common` is a workspace MEMBER, and it
 * pulls citadel_sdk with `features = ["localhost-testing"]`. Cargo unifies
 * features across the selected package set, so a workspace-wide
 * `cargo build --release --bin X` compiles that feature into X.
 *
 * At the pinned SDK revision that is not a logging switch. It replaces the
 * NAT-traversal config encryption with identity functions ("In localhost-testing
 * mode, encryption is disabled"), skips STUN probing entirely, binds UDP to
 * loopback, and reports NatType::offline(). P2P then works in the dev compose
 * stack and cannot traverse a real NAT in production — with no error anywhere.
 *
 * The workspace-server image already avoided this via a Cargo.docker.toml that
 * excludes tests/common; the internal-service image did not, which is the
 * fixed-in-one-place shape this repo keeps producing. Hence a check rather
 * than a second one-off.
 *
 * A production Dockerfile must therefore either scope the build with `-p` or
 * supply a workspace override that excludes the test-support member.
 */
import { readFileSync, existsSync } from 'node:fs';

const DOCKERFILES = [
  'docker/internal-service/Dockerfile',
  'docker/workspace-server/Dockerfile',
];

// Members that enable a test-only feature and must not be in a shipped build.
const TEST_MEMBERS = ['citadel-workspace-server-kernel/tests/common'];

const problems = [];

for (const file of DOCKERFILES) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');

  // Every release build in the file.
  const builds = [...text.matchAll(/^RUN\s+cargo\s+build[^\n]*--release[^\n]*$/gm)].map((m) => m[0]);
  if (builds.length === 0) continue;

  // A workspace override that drops the test member is the alternative remedy.
  const overrideMatch = /COPY\s+\S*(Cargo\.docker\.toml)\s/.exec(text);
  let overrideExcludes = false;
  if (overrideMatch && existsSync(`docker/${file.split('/')[1]}/Cargo.docker.toml`)) {
    const override = readFileSync(`docker/${file.split('/')[1]}/Cargo.docker.toml`, 'utf8');
    overrideExcludes = TEST_MEMBERS.every((m) => !override.includes(m));
  }

  for (const build of builds) {
    const scoped = /\s-p\s+\S/.test(build);
    if (!scoped && !overrideExcludes) {
      problems.push(
        `${file}\n      ${build.trim()}\n` +
          '      → neither scoped with `-p` nor built against a workspace override that\n' +
          '        excludes the test-support member, so localhost-testing is unified in.',
      );
    }
  }
}

if (problems.length > 0) {
  console.error('A shipped binary may be compiled with a test-only feature:\n');
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('Scope the build (`cargo build --release -p <package> --bin <bin>`) or copy a');
  console.error('Cargo.docker.toml that omits the test-support member, as workspace-server does.');
  process.exit(1);
}

console.log('No shipped binary is built with a test-only cargo feature.');
