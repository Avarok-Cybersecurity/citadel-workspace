/**
 * The chat documents this tab has open, by account: one writer per device copy. While a
 * document is open its keeper records every update it applies; the inbox (chat-inbox.ts),
 * which records what arrives for a closed one, leaves an open one alone, so the two never
 * write the same copy over each other.
 */
const open: Map<string, number> = new Map<string, number>();
const keyOf = (account: bigint, docId: string): string => `${account.toString()}:${docId}`;

/** Marks the document open until the returned function is called. */
export function holdOpen(account: bigint, docId: string): () => void {
  const key: string = keyOf(account, docId);
  open.set(key, (open.get(key) ?? 0) + 1);
  let held: boolean = true;
  return (): void => {
    if (!held) return;
    held = false;
    const left: number = (open.get(key) ?? 1) - 1;
    if (left === 0) open.delete(key);
    else open.set(key, left);
  };
}

export function isOpenHere(account: bigint, docId: string): boolean {
  return open.has(keyOf(account, docId));
}
