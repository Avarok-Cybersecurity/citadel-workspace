import { MessageCircle } from 'lucide-react';

/** What the chat pane says before a peer is chosen. */
export function NoConversation(): JSX.Element {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-background">
      <MessageCircle className="h-12 w-12 text-muted-foreground mb-4" />
      <p className="text-muted-foreground">Select a conversation to start messaging</p>
    </div>
  );
}
