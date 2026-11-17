/**
 * The console keywords a run must keep when the composer is involved.
 *
 * `OfficeChatTabs` logs `[OfficeChatTabs] composer withheld {...}` when it
 * removes the composer -- the one line that says WHICH of the permission
 * states produced the refusal. The legacy `tests/` specs call
 * `setupConsoleCapture` and their keyword lists do match it (`OfficeChatTabs`
 * lowercases to something containing "chat"), but no `tests-pw` spec captures
 * console output at all. `touch-controls.spec.ts` builds its own context and
 * attaches nothing, so when its send failed, the run reported "Message input
 * not found" and the app's own explanation went to a console nobody read.
 *
 * One list, exported, so a spec does not have to guess which words to keep --
 * and a test asserting it really does match the line the app emits, because a
 * filter that silently matches nothing is the same defect wearing a filter.
 */
export const RUN_DIAGNOSTIC_KEYWORDS: readonly string[] = [
  'withheld',
  'restricted',
  'permission',
  'error',
  'ILM',
  // `peer-group` failed on "group creation produced no group id" with 2,271
  // captured console lines and not one of them about a group: the app logs
  // `[GroupStore] Group created:` and `[UseGroupConversations]`, and neither
  // matched a word on this list. Capture that says nothing about the thing
  // that failed is capture that was not turned on.
  'group',
];

/** A representative line, kept beside the list so a test can check the two agree. */
export const COMPOSER_WITHHELD_SAMPLE: string =
  '[OfficeChatTabs] composer withheld {nodeId: 12n, role: null, allowed: false, answered: true}';

export function keywordsMatch(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => text.toLowerCase().includes(kw.toLowerCase()));
}
