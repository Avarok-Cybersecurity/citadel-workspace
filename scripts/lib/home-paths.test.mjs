import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homePathsIn } from './home-paths.mjs';
import { remapFlags, targetRustflagsEnv } from './remap-paths.mjs';

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

test('the flags map the checkout and cargo home, in that order, then extras', () => {
  assert.deepEqual(remapFlags({ root: '/r', home: '/h', extra: [['/d', '/citadel-docs']] }), [
    '--remap-path-prefix=/r=/citadel-workspace',
    '--remap-path-prefix=/h=/cargo',
    '--remap-path-prefix=/d=/citadel-docs',
  ]);
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
