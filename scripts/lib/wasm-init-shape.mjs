/**
 * wasm-bindgen init calls made with the deprecated signature. Pure: one source in, its offending
 * calls out.
 *
 * The glue's default export (`__wbg_init`) and `initSync` take ONE object --
 * `{ module_or_path }` and `{ module }` -- and warn "using deprecated parameters for the
 * initialization function; pass a single object instead" when handed a bare URL or bytes. Only a
 * source that imports a wasm-bindgen glue module is judged, so an unrelated `.default(x)` or a
 * service's own `init()` is not.
 */
const GLUE = /(?:import\s*\(|from)\s*['"`][^'"`]*(?:_wasm_client|cdoc_wasm_|calendar_glue|_glue|citadel_tenant_server_wasm|\/pkg\/)[^'"`]*\.js['"`]/;
const DEFAULT_IMPORT = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s*['"][^'"]*\.js['"]/g;

export function deprecatedInitCalls(source) {
  if (!GLUE.test(source)) return [];
  const names = ['[\\w$]+\\.default', 'initSync', '__wbg_init'];
  for (const m of source.matchAll(DEFAULT_IMPORT)) names.push(m[1].replace(/\$/g, '\\$'));
  const call = new RegExp(`(?<![\\w$.])(${names.join('|')})\\(\\s*([^\\s)])`, 'g');
  const found = [];
  for (const m of source.matchAll(call)) {
    if (m[2] === '{') continue;
    const line = source.slice(0, m.index).split('\n').length;
    found.push({ line, call: m[0].trim() });
  }
  return found;
}
