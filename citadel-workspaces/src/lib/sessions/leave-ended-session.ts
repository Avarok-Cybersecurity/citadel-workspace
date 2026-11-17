/**
 * Leaving a workspace whose session is gone, saying why.
 *
 * Every way a session ends under a window -- signed out or deleted in another
 * window, moved to another window and not taken back, signed out by the
 * server -- ends here. Unsaved editor text is asked about first, as any other
 * navigation away from the editor is (lib/leave-editor.ts). A user who keeps
 * it stays, with the text on screen to copy, and is told the session is over.
 */
export interface LeaveIO {
  /** True when nothing unsaved would be lost, or the user agreed to lose it. */
  mayLeave: () => Promise<boolean>;
  navigate: (path: string) => void;
  /** Say `message`; `stayed` when the window kept the page for unsaved text. */
  tell: (message: string, stayed: boolean) => void;
}

export async function leaveEndedSession(io: LeaveIO, path: string, message: string): Promise<void> {
  if (await io.mayLeave()) {
    io.tell(message, false);
    io.navigate(path);
    return;
  }
  io.tell(`${message} Your unsaved text is still here to copy; nothing you do on this page is saved.`, true);
}
