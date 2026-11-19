/**
 * Fixed ports in a browser gate's server setup. Pure: one source in, its fixed ports out.
 *
 * Every gate's server takes a port chosen per run (lib/free-port.mjs): `freePort()` for a server in
 * another process, port 0 for an in-process `preview()`. A fixed one -- a literal, or an env
 * override falling back to a literal -- collides with a concurrent run of the same gate. The
 * agent ports are exempt: they are deliberately CLOSED ports the preview proxies to, never bound.
 */
const RULES = [
  [/\bconst PORT\s*=(?!\s*await freePort\(\))[^;\n]+/g, 'PORT is not chosen per run (await freePort())'],
  [/process\.env\.(?![A-Z0-9_]*AGENT)[A-Z0-9_]*PORT\s*\?\?\s*\d+/g, 'an env override falling back to a fixed port'],
  [/preview:\s*\{\s*port(?!:\s*0\b)[^,}]*/g, 'preview() on a port other than 0'],
  [/'--port',\s*'\d+'/g, 'a literal --port'],
  [/\.listen\(\s*\d{2,}/g, 'a server listening on a literal port'],
];

export function fixedPorts(source) {
  const found = [];
  for (const [rule, why] of RULES) {
    for (const m of source.matchAll(rule)) found.push({ line: source.slice(0, m.index).split('\n').length, text: m[0].trim(), why });
  }
  return found.sort((a, b) => a.line - b.line);
}
