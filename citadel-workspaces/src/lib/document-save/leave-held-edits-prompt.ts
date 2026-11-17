/** What a sign-out with edits held on this device asks: the one place the wording lives. */
export interface HeldEditsPrompt {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
}

const documents = (count: number): string => (count === 1 ? '1 document has' : `${count} documents have`);

export function syncHeldEditsPrompt(count: number): HeldEditsPrompt {
  return {
    title: 'Send your edits before signing out?',
    description: `${documents(count)} edits that are only on this device. Signing out deletes them from this device.`,
    confirmLabel: 'Sync now',
  };
}

export function discardHeldEditsPrompt(count: number): HeldEditsPrompt {
  return {
    title: 'Delete edits that were never sent?',
    description: `${documents(count)} edits that are only on this device and could not be sent. Signing out deletes them for good.`,
    confirmLabel: 'Delete and sign out',
  };
}
