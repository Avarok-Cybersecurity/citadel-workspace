/** What a chat's document pane says when a document opens other than as a live canvas, in one place. */

export type UnopenedReason =
  | { readonly kind: 'earlier-editor' }
  | { readonly kind: 'load-failed'; readonly message: string }
  | { readonly kind: 'no-account' };

export interface UnopenedCopy {
  readonly heading: string;
  readonly body: string;
}

export function unopenedCopy(reason: UnopenedReason, title: string, peerName: string): UnopenedCopy {
  switch (reason.kind) {
    case 'earlier-editor':
      return {
        heading: 'This document cannot be opened',
        body: `“${title}” was made in the earlier chat editor, which this version of the app no longer opens. ${peerName} can share it again as a new document.`,
      };
    case 'load-failed':
      return { heading: 'This document could not be opened', body: `“${title}” could not be opened: the editor did not load (${reason.message}).` };
    case 'no-account':
      return {
        heading: 'This document cannot open yet',
        body: 'Documents open once your session has finished signing in.',
      };
  }
}
