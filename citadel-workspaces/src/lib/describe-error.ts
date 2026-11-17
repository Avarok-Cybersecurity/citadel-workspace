/**
 * An unknown thrown value, as a sentence a person can read.
 *
 * `catch (err) { toast.error(\`Failed to delete: ${err}\`) }` was written eight
 * times in one file, three different ways, and none of them safe:
 *
 *   | thrown                  | what the toast said                       |
 *   |-------------------------|-------------------------------------------|
 *   | `new Error('timed out')`| `Failed to delete: Error: timed out`      |
 *   | `{ code: 5 }`           | `Failed to delete: [object Object]`       |
 *   | `'timed out'`           | `Failed to delete: timed out`             |
 *
 * The middle row is the one that matters. A rejection carrying a structured
 * payload — which the revfs and websocket layers both produce — reaches the
 * user as `[object Object]`, and there is nothing in it to search for, report
 * or act on. The first row is milder and still wrong: `Error:` is a JavaScript
 * class name, not a word addressed to anybody.
 *
 * Never returns `[object Object]`. When there is genuinely no message, it says
 * what it was given instead of pretending to quote it.
 */
export function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message !== '') return error.message;

  if (typeof error === 'object' && error !== null) {
    const message: unknown = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;

    // Some layers reject with `{ error: '...' }` rather than `{ message }`.
    const alternative: unknown = (error as { error?: unknown }).error;
    if (typeof alternative === 'string' && alternative !== '') return alternative;

    // Naming the shape beats quoting `[object Object]`: it tells whoever
    // receives the screenshot which layer to look in.
    const keys: string[] = Object.keys(error).slice(0, 4);
    return keys.length > 0
      ? `an unexpected error (fields: ${keys.join(', ')})`
      : 'an unexpected error';
  }

  if (error === undefined || error === null) return 'an unexpected error';
  return String(error);
}
