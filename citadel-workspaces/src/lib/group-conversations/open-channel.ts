/**
 * Which group channels are on screen in this tab right now.
 *
 * A peer group is read at `/groups/:id`, so the notification bell could tell from the URL that
 * you were reading it. An office/room chat lives under `/workspace`, keyed by its node, and its
 * channel id never appears in the URL -- so messages in the chat you were reading still rang.
 * The chat view marks its channel open while it is shown; the bell asks here.
 */
const open: Map<string, number> = new Map();

/** Mark `channelId` as shown; call the returned function when it no longer is. */
export function markChannelOpen(channelId: string): () => void {
  open.set(channelId, (open.get(channelId) ?? 0) + 1);
  let released: boolean = false;
  return (): void => {
    if (released) return;
    released = true;
    const left: number = (open.get(channelId) ?? 1) - 1;
    if (left <= 0) open.delete(channelId); else open.set(channelId, left);
  };
}

export function isChannelOpen(channelId: string): boolean {
  return open.has(channelId);
}
