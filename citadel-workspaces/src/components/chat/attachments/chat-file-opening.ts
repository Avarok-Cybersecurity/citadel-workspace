/**
 * Which app opens a file shown in a chat: the same lookup the file manager asks
 * (lib/citadel-apps/openers). Pure. A file whose bytes this conversation cannot read into the page
 * is offered to no app (null), so activating it is the download alone.
 */
import { openersFor, type FileOpener, type Openers } from '@/lib/citadel-apps/openers/openers';

export function chatFileOpeners(name: string, readable: boolean, available: readonly FileOpener[], lastChoice: string | null): Openers | null {
  return readable ? openersFor(name, available, lastChoice) : null;
}
