/**
 * The WASM client's glue (`citadel_internal_service_wasm_client.js`) is built by wasm-pack and
 * absent from a clean checkout (typescript-client/.gitignore), so a harness build that reaches the
 * session's services through any import, even a lazy one it never loads, cannot resolve it. A
 * harness page calls no agent; this resolves the glue to an empty module.
 */
const WASM_STUB = '\0wasm-stub';

export const stubWasmClient = () => ({
  name: 'stub-wasm-client',
  resolveId: (id) => (/citadel[-_]internal[-_]service[-_]wasm[-_]client/.test(id) ? { id: WASM_STUB, moduleSideEffects: false } : undefined),
  load: (id) => (id === WASM_STUB ? 'export default {}' : undefined),
});
