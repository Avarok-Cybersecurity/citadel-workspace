import { isEnterCommit } from '@/lib/keyboard-commit';

/**
 * Does this keypress mean "send"?
 *
 * The composition half of the rule lives in `isEnterCommit`, shared with the
 * rename input, the path bar and the document-title modal — it was written here
 * first and stayed here, so those three handled Enter themselves without it.
 * What is specific to a composer is the shift clause: Shift+Enter inserts a
 * newline rather than sending.
 */
export function shouldSendOnKey(event: {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing: boolean };
}): boolean {
  return isEnterCommit(event) && !event.shiftKey;
}
