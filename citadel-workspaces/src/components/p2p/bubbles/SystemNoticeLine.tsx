import type { PaneMessage } from '@/lib/chat/transport/chat-transport';

/**
 * A line the app writes into the thread (`message_type: 'system_notice'`).
 * Nobody typed it, so it has no bubble, no sender styling and no actions.
 */
export function SystemNoticeLine({ message }: { message: PaneMessage }): JSX.Element {
  return (
    <p role="status" className="w-full text-center text-xs text-muted-foreground py-1">
      {message.content}
    </p>
  );
}
