/**
 * The browser's SentPictureStore: this tab's memory over the app's IndexedDB key-value store
 * (storage-utils.ts), whose structured clone keeps a Blob as is. Account-scoped by the key
 * (sent-pictures.ts).
 *
 * Two tiers because IndexedDB may refuse a Blob: WebKit's ephemeral storage (Safari private
 * browsing) cannot hold one. Memory still shows the picture full size for the rest of the tab;
 * only a reload falls back to the thumbnail, and the refusal is reported, not hidden.
 */
import { dbDelete, dbGet, dbKeysWithPrefix, dbPut } from '@/lib/storage-utils';
import type { SentPictureEntry, SentPictureStore } from './sent-pictures';

const memory: Map<string, SentPictureEntry> = new Map();

export const browserSentPictureStore: SentPictureStore = {
  put: async (key: string, entry: SentPictureEntry): Promise<void> => {
    memory.set(key, entry);
    try {
      await dbPut('keyValue', key, entry);
    } catch (error: unknown) {
      console.warn('[SentPictures] kept for this tab only; this browser refused to store it', error);
    }
  },
  get: async (key: string): Promise<SentPictureEntry | undefined> => memory.get(key) ?? (await dbGet<SentPictureEntry>('keyValue', key)),
  keys: async (prefix: string): Promise<string[]> => {
    const stored: string[] = await dbKeysWithPrefix('keyValue', prefix).catch((error: unknown): string[] => {
      console.warn('[SentPictures] stored pictures unreadable; budgeting this tab\'s only', error);
      return [];
    });
    return [...new Set([...stored, ...[...memory.keys()].filter((k: string): boolean => k.startsWith(prefix))])];
  },
  delete: async (key: string): Promise<void> => {
    memory.delete(key);
    await dbDelete('keyValue', key);
  },
};
