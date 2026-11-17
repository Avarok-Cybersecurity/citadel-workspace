/**
 * What to tell the user when something failed.
 *
 * The recurring defect this exists to end: a catch that reports a fixed
 * sentence — "Please try again", "Could not update" — while sending the real
 * reason to `debugLog`, which is compiled out of production. The server does
 * say why. `awaitWriteResponse` surfaces "Permission denied: EditTreeStructure
 * required" and "Cannot demote the only administrator"; the transport surfaces
 * timeouts and disconnections. All of it was being replaced by a sentence that
 * says only that something went wrong, so the user could not tell an operation
 * that will NEVER succeed from one worth retrying — and retried the first kind.
 *
 * `fallback` is for the genuinely unknown: a thrown non-Error, or an empty
 * message. It should still say what was being attempted, because "Unknown
 * error" tells the reader less than the button they just pressed.
 */
export function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  // The WASM client rejects with plain objects as well as strings.
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    const message: string = (error as { message: string }).message;
    if (message.trim()) return message;
  }
  return fallback;
}
