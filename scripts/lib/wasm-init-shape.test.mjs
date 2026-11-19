import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deprecatedInitCalls } from './wasm-init-shape.mjs';

const client = (call) => `const wasmModule = await import('../citadel_internal_service_wasm_client.js');\n${call}\n`;

test('a bare URL to the glue default export is the deprecated form', () => {
  assert.deepEqual(deprecatedInitCalls(client('await wasmModule.default(wasmBinaryUrl);')), [
    { line: 2, call: 'wasmModule.default(w' },
  ]);
});

test('the object forms pass', () => {
  assert.deepEqual(deprecatedInitCalls(client('await wasmModule.default({ module_or_path: url });')), []);
  assert.deepEqual(deprecatedInitCalls(client('glue.initSync({ module: bytes });')), []);
  assert.deepEqual(deprecatedInitCalls(client('await wasmModule.default();')), []);
});

test('bytes to initSync and a renamed default import are caught', () => {
  assert.equal(deprecatedInitCalls(client('initSync(bytes);')).length, 1);
  const named = "import init, { initSync } from './pkg/x_glue.js';\nawait init(url);\n";
  assert.deepEqual(deprecatedInitCalls(named), [{ line: 2, call: 'init(u' }]);
});

test('a source that imports no glue is not judged', () => {
  assert.deepEqual(deprecatedInitCalls('await render.default(components);\nawait service.init(url);'), []);
});
