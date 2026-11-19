/**
 * Home-directory paths inside a built artefact: `/Users/<name>/`, `/home/<name>/`, and Windows'
 * `C:\Users\<name>\` (either slash). Pure: bytes in, the distinct matches out.
 *
 * A binary is read as latin1, so every byte is one character and a path embedded in a .wasm data
 * segment or a Mach-O string table reads exactly as it does in a text file.
 */
const HOME = /(?:\/Users\/|\/home\/|\b[A-Za-z]:[\\/]Users[\\/])[A-Za-z0-9._-]+[\\/]/;
const PATH = new RegExp(`${HOME.source}[^\\0\\s"']*`, 'g');

/**
 * The distinct home prefixes found, skipping any whole path under one of `allowUnder`: a
 * directory the caller names because a C build compiled it in, which rustc's remapping cannot
 * reach (vendored OpenSSL's ENGINESDIR). Each allowance is the caller's to justify.
 */
export function homePathsIn(bytes, { allowUnder = [] } = {}) {
  const text = Buffer.from(bytes).toString('latin1');
  const found = (text.match(PATH) ?? []).filter((p) => !allowUnder.some((dir) => p.startsWith(dir)));
  return [...new Set(found.map((p) => p.match(HOME)[0]))].sort();
}
