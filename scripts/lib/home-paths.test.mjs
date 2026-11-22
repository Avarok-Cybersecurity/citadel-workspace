import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HIT_PATH_MAX, homePathHits, homePathsIn } from './home-paths.mjs';
import { cFlags, commitHashOf, remapFlags, rustToolchain, targetCompilerFlagsEnv, targetRustflagsEnv } from './remap-paths.mjs';
import { deploymentTargetEnv, minimumSystemVersion, readInfoPlist } from './macos-deployment-target.mjs';

const bytes = (s) => Buffer.from(s, 'latin1');

test('a macOS home path inside binary bytes is found', () => {
  const wasm = Buffer.concat([Buffer.from([0, 97, 115, 109]), bytes('\0/Users/nologik/.cargo/registry/src/x.rs\0')]);
  assert.deepEqual(homePathsIn(wasm), ['/Users/nologik/']);
});

test('Linux and Windows homes are found, each once', () => {
  const found = homePathsIn(bytes('/home/runner/.cargo/a /home/runner/.cargo/b C:\\Users\\runneradmin\\.cargo D:/Users/x/y'));
  assert.deepEqual(found, ['/home/runner/', 'C:\\Users\\runneradmin\\', 'D:/Users/x/']);
});

test('remapped paths and lookalikes are not home paths', () => {
  assert.deepEqual(homePathsIn(bytes('/cargo/registry/src/x.rs /citadel-workspace/a.rs /rustc/abc/library /Users /homes/a/')), []);
});

test('a path under an allowed directory is skipped, its siblings are not', () => {
  const binary = bytes('ENGINESDIR: "/home/runner/work/cw/target/build/openssl-sys/1/out/install/lib/engines-3"\0/home/runner/.cargo/registry/x.rs');
  assert.deepEqual(homePathsIn(binary, { allowUnder: ['/home/runner/work/cw/target/build/openssl-sys/'] }), ['/home/runner/']);
  assert.deepEqual(homePathsIn(bytes('/home/runner/work/cw/target/build/openssl-sys/1/x'), { allowUnder: ['/home/runner/work/cw/target/build/openssl-sys/'] }), []);
});

const HASH = '0ef1bc386059596dada8fb65b50425aab2ea637a';
const TOOLCHAIN = { sysroot: '/s', commitHash: HASH };

test("the flags map the checkout and cargo home, in that order, then extras, then std's sources", () => {
  assert.deepEqual(remapFlags({ root: '/r', home: '/h', extra: [['/d', '/citadel-docs']], toolchain: TOOLCHAIN }), [
    '--remap-path-prefix=/r=/citadel-workspace',
    '--remap-path-prefix=/h=/cargo',
    '--remap-path-prefix=/d=/citadel-docs',
    `--remap-path-prefix=/s/lib/rustlib/src/rust=/rustc/${HASH}`,
  ]);
});

test("rust-src's sysroot path, which the gate finds, is mapped to the prefix rustc writes without it", () => {
  const sysroot = '/Users/nologik/.rustup/toolchains/stable-aarch64-apple-darwin';
  const leaked = bytes(`\0${sysroot}/lib/rustlib/src/rust/library/core/src/iter/adapters/step_by.rs\0`);
  assert.deepEqual(homePathsIn(leaked), ['/Users/nologik/']);
  const flag = remapFlags({ root: '/r', home: '/h', toolchain: { sysroot, commitHash: HASH } }).at(-1);
  assert.equal(flag, `--remap-path-prefix=${sysroot}/lib/rustlib/src/rust=/rustc/${HASH}`);
});

test('without the toolchain of the build, no flags are made', () => {
  assert.throws(() => remapFlags({ root: '/r', home: '/h' }), /no toolchain sysroot/);
  assert.throws(() => remapFlags({ root: '/r', home: '/h', toolchain: { sysroot: '/s', commitHash: 'abc' } }), /not a rustc commit hash/);
});

test("the commit hash is rustc -vV's, and a version without one is refused", () => {
  assert.equal(commitHashOf(`rustc 1.100.0 (0ef1bc386 2026-11-09)\nbinary: rustc\ncommit-hash: ${HASH}\nhost: x\n`), HASH);
  assert.throws(() => commitHashOf('rustc 1.100.0\ncommit-hash: unknown\n'), /names no commit-hash/);
});

test("the toolchain is the one rustc reports where the build runs", () => {
  const { sysroot, commitHash } = rustToolchain(process.cwd());
  assert.ok(sysroot.length > 1 && /^[0-9a-f]{40}$/.test(commitHash), `${sysroot} ${commitHash}`);
});

test("a macOS build targets the app bundle's minimum, and only a macOS build does", () => {
  const plist = readInfoPlist();
  assert.deepEqual(deploymentTargetEnv('aarch64-apple-darwin', plist), { name: 'MACOSX_DEPLOYMENT_TARGET', value: minimumSystemVersion(plist) });
  assert.equal(deploymentTargetEnv('x86_64-apple-darwin', plist).value, minimumSystemVersion(plist));
  assert.throws(() => deploymentTargetEnv('x86_64-unknown-linux-musl', plist), /not a macOS target/);
  assert.throws(() => minimumSystemVersion('<dict></dict>'), /no LSMinimumSystemVersion/);
  assert.throws(() => minimumSystemVersion('<key>LSMinimumSystemVersion</key><string>13</string>'), /major\.minor/);
});

test('the env variable is the per-target one cargo merges with config rustflags', () => {
  assert.deepEqual(targetRustflagsEnv('wasm32-unknown-unknown', ['-a', '-b']), {
    name: 'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS',
    value: '-a -b',
  });
});

test('a path cargo would split on whitespace is refused', () => {
  assert.throws(() => targetRustflagsEnv('x86_64-pc-windows-msvc', ['--remap-path-prefix=/a b=/cargo']), /whitespace/);
});

test('each hit names its byte offset and the whole embedded path', () => {
  const binary = bytes('\0\0C:\\Users\\runneradmin\\.cargo\\registry\\src\\x\\a.c\0/home/runner/b.rs');
  assert.deepEqual(homePathHits(binary), [
    { offset: 2, path: 'C:\\Users\\runneradmin\\.cargo\\registry\\src\\x\\a.c' },
    { offset: 49, path: '/home/runner/b.rs' },
  ]);
});

test('a long hit is truncated, so one string cannot flood the log', () => {
  const [hit] = homePathHits(bytes(`/home/runner/${'a'.repeat(500)}`));
  assert.equal(hit.path.length, HIT_PATH_MAX + 3);
  assert.ok(hit.path.endsWith('...'));
});

test('cl trims the same roots; GCC and Clang take no C flags, which OpenSSL would record', () => {
  const roots = { root: '/r', home: '/h', extra: [['/d', '/citadel-docs']] };
  assert.deepEqual(cFlags('x86_64-pc-windows-msvc', roots), ['/d1trimfile:/r', '/d1trimfile:/h', '/d1trimfile:/d']);
  for (const triple of ['x86_64-unknown-linux-musl', 'aarch64-apple-darwin', 'x86_64-apple-darwin']) {
    assert.deepEqual(cFlags(triple, roots), [], triple);
  }
});

test("a remap flag OpenSSL compiled into its 'compiler:' string is a home path the gate finds", () => {
  const buildinf = bytes(
    'compiler: x86_64-linux-musl-gcc -O2 -ffile-prefix-map=/home/runner/work/cw/cw=/citadel-workspace -ffile-prefix-map=/home/runner/.cargo=/cargo -DNDEBUG\0',
  );
  assert.deepEqual(homePathHits(buildinf), [
    { offset: 54, path: '/home/runner/work/cw/cw=/citadel-workspace' },
    { offset: 115, path: '/home/runner/.cargo=/cargo' },
  ]);
});

test('the C variables are the per-target ones the cc crate reads', () => {
  assert.deepEqual(targetCompilerFlagsEnv('CFLAGS', 'x86_64-pc-windows-msvc', ['/a', '/b']), {
    name: 'CFLAGS_x86_64_pc_windows_msvc',
    value: '/a /b',
  });
  assert.equal(targetCompilerFlagsEnv('CXXFLAGS', 'aarch64-apple-darwin', []).name, 'CXXFLAGS_aarch64_apple_darwin');
  assert.throws(() => targetCompilerFlagsEnv('LDFLAGS', 'aarch64-apple-darwin', []), /CFLAGS or CXXFLAGS/);
  assert.throws(() => targetCompilerFlagsEnv('CFLAGS', 'x86_64-pc-windows-msvc', ['/d1trimfile:C:\\a b']), /whitespace/);
});
