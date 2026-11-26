/**
 * `AppEvent::StorageChanged`, from the server's `StorageChanged` push (Calendar design §3.3.1): an
 * app wrote to a node this person may view. Each running instance of THAT install hears one event
 * per key; an instance of any other install hears nothing. The event names the store and the key,
 * never a value: the app reads the key again through its own storage port, with its own rights.
 *
 * One session serves every tab in a browser, so the writer's own instances are told too.
 */
import type { AppEvent } from '../sdk/generated/AppEvent';
import type { StorageChange } from '../host/glue-instance';
import { readAppsAnswer, type AppsAnswer } from '../wire/apps-answer';
import type { OwnWrites } from './own-store-writes';

/** Every apps answer the server pushes to this tab; returns the unsubscribe. */
export type AppsPushes = (listener: (answer: unknown) => void) => () => void;

/** Calls `deliver` with each StorageChanged event for `installId`; returns the unsubscribe. */
export function onStorageChanged(pushes: AppsPushes, installId: string, deliver: (event: AppEvent) => void): () => void {
  return pushes((payload: unknown): void => {
    const answer: AppsAnswer = readAppsAnswer(payload);
    if (answer.kind !== 'storage-changed' || answer.installId !== installId) return;
    for (const key of answer.keys) deliver({ storage_changed: { backend: answer.backend, key } });
  });
}

/**
 * Every change an instance of `installId` hears: the kernel's announcements (node stores) and the
 * member's own-store writes (own-store-writes.ts; null when nobody is signed in). Returns the unsubscribe.
 */
export function onInstallChanges(pushes: AppsPushes, own: OwnWrites | null, installId: string, listener: (change: StorageChange) => void): () => void {
  const offKernel: () => void = onStorageChanged(pushes, installId, (event: AppEvent): void => {
    if (typeof event === 'object' && 'storage_changed' in event) listener(event.storage_changed);
  });
  const offOwn: () => void = own === null ? (): void => {} : own.listen(installId, listener);
  return (): void => { offKernel(); offOwn(); };
}
