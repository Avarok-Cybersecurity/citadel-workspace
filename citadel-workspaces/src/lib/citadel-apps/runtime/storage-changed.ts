/**
 * `AppEvent::StorageChanged`, from the server's `StorageChanged` push (Calendar design §3.3.1): an
 * app wrote to a node this person may view. Each running instance of THAT install hears one event
 * per key; an instance of any other install hears nothing. The event names the store and the key,
 * never a value: the app reads the key again through its own storage port, with its own rights.
 *
 * One session serves every tab in a browser, so the writer's own instances are told too.
 */
import type { AppEvent } from '../sdk/generated/AppEvent';
import { readAppsAnswer, type AppsAnswer } from '../wire/apps-answer';

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
