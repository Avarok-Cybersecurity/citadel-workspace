/**
 * Who an app's notice is from, as the server said it. The host keeps the changes the server told
 * this install of from a member's own namespace on a node (`StorageChanged` with `node_authored`,
 * which only that member can write). A `Notify` may point at one (`about`); the host names its
 * author only when it is one of those, so an app can never put a name on a notice. A change in a
 * node's shared store names no one, and neither does its notice. Bounded: past TOLD_MAX the oldest
 * is forgotten.
 */
import type { NotifyAbout } from '../sdk/generated/NotifyAbout';
import type { StorageBackend } from '../sdk/generated/StorageBackend';

export const TOLD_MAX: number = 256;

export interface ToldAuthors {
  readonly heard: (backend: StorageBackend, key: string) => void;
  readonly authorOf: (about: NotifyAbout) => string | null;
}

const idOf = (node: string, author: string, key: string): string => JSON.stringify([node, author, key]);

export function toldAuthors(): ToldAuthors {
  const told: Set<string> = new Set<string>();
  return {
    heard: (backend: StorageBackend, key: string): void => {
      if (typeof backend !== 'object' || !('node_authored' in backend)) return;
      const id: string = idOf(backend.node_authored.node_id, backend.node_authored.author, key);
      told.delete(id);
      told.add(id);
      if (told.size <= TOLD_MAX) return;
      const oldest: string | undefined = told.values().next().value;
      if (oldest !== undefined) told.delete(oldest);
    },
    authorOf: (about: NotifyAbout): string | null => (told.has(idOf(about.node_id, about.author, about.key)) ? about.author : null),
  };
}
