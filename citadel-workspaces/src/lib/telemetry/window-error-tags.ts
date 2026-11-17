/**
 * The first argument main.tsx's window handlers log with. Console capture reads a line's source
 * from it (console-capture/format.ts), so the window's `error` and `unhandledrejection` events
 * reach the opt-in diagnostic logs through those handlers rather than second listeners.
 */
export const WINDOW_ERROR_TAG: string = '[MAIN ERROR]';
export const REJECTION_TAG: string = '[MAIN REJECTION]';
