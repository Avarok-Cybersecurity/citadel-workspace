/**
 * Home-directory paths inside a built artefact: `/Users/<name>/`, `/home/<name>/`, and Windows'
 * `C:\Users\<name>\` (either slash). Pure: bytes in, the distinct matches out.
 *
 * A binary is read as latin1, so every byte is one character and a path embedded in a .wasm data
 * segment or a Mach-O string table reads exactly as it does in a text file.
 */
const HOME = /(?:\/Users\/|\/home\/|\b[A-Za-z]:[\\/]Users[\\/])[A-Za-z0-9._-]+[\\/]/;
const PATH = new RegExp(`${HOME.source}[^\\0\\s"']*`, 'g');

/** The longest path a hit reports: enough to name the crate and file, bounded for a log line. */
export const HIT_PATH_MAX = 200;

/**
 * Every home path found, in byte order, as `{ offset, path }`: the byte offset into the
 * artefact and the whole embedded string (truncated to HIT_PATH_MAX), skipping any whole path
 * under one of `allowUnder` -- a directory the caller names because a C build compiled it in,
 * which rustc's remapping cannot reach (vendored OpenSSL's ENGINESDIR). Each allowance is the
 * caller's to justify.
 */
export function homePathHits(bytes, { allowUnder = [] } = {}) {
  const text = Buffer.from(bytes).toString('latin1');
  return [...text.matchAll(PATH)]
    .filter((m) => !allowUnder.some((dir) => m[0].startsWith(dir)))
    .map((m) => ({ offset: m.index, path: m[0].length > HIT_PATH_MAX ? `${m[0].slice(0, HIT_PATH_MAX)}...` : m[0] }));
}

/** The distinct home prefixes among homePathHits, sorted. */
export function homePathsIn(bytes, options) {
  return [...new Set(homePathHits(bytes, options).map((h) => h.path.match(HOME)[0]))].sort();
}
