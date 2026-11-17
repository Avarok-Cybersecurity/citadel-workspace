/**
 * The account whose stored record cannot reconnect (no server is known for it, and
 * the agent could not say), held until a window shows its sign-in. A store, not an
 * event: the reconnect that finds it may run before the watcher has loaded.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';

export const signInNeededFor: ValueStore<string | null> = createValueStore<string | null>('sign-in-needed', null);
