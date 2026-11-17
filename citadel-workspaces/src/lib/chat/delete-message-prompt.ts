/**
 * The confirmation before a message is destroyed for everyone.
 *
 * Deleting a chat message was one click, in a dropdown where Delete sits
 * directly under Edit and Reply, in both chat grammars. A mis-click destroyed
 * the message permanently, for every participant, with no undo — while every
 * other destructive action in this app (node delete, group delete, kick,
 * removing a saved account, disconnecting) asks first.
 *
 * Shared so the two chats cannot drift into asking different questions, or one
 * of them into asking none, which is how this started.
 */

export const DELETE_MESSAGE_PROMPT: { readonly title: "Delete this message?"; readonly description: "It will be removed for everyone in this conversation, and cannot be restored."; readonly confirmLabel: "Delete"; } = {
  title: 'Delete this message?',
  description:
    'It will be removed for everyone in this conversation, and cannot be restored.',
  confirmLabel: 'Delete',
} as const;
