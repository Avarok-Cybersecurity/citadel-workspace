/**
 * The recovery phrase as one block of text: what Copy puts on the clipboard and Download saves.
 * Pure. It names the account and its server, so the file is not a mystery in a year.
 */
import type { RecoveryPhrase } from './secret';

export const PHRASE_FILE_NAME: 'citadel-recovery-phrase.txt' = 'citadel-recovery-phrase.txt';

export function phraseText(words: RecoveryPhrase, account: string, server: string | null): string {
  const numbered: string = words.map((word: string, i: number) => `${String(i + 1).padStart(2, ' ')}. ${word}`).join('\n');
  const where: string = server === null ? account : `${account} on ${server}`;
  return `Citadel recovery phrase for ${where}\n` +
    'Anyone with these can take over the account. Keep them offline and private.\n\n' +
    `${numbered}\n`;
}
