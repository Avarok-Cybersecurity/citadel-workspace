/**
 * A file's extension, as every "which app opens this" decision reads it: the text after the
 * last dot, lower-cased; none for a name with no dot, and none for a dotfile (`.env`), whose dot
 * starts its name rather than an extension. `a.tar.gz` is a `.gz` file.
 */
export function extensionOf(name: string): string {
  const dot: number = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}
