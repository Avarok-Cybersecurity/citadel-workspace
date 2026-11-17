/**
 * Whether the reader may send (or any other answer about the reader), as the live value a
 * transport holds.
 *
 * A role can change while a conversation is open, and the transport is built once per
 * conversation (rebuilding it would reload the history), so the answer lives in a store the
 * transport reads and this keeps it current.
 */
import { useEffect, useState } from 'react';
import { createValueStore, type ValueStore } from '@/lib/value-store';

export function useLiveGate<T>(context: string, value: T): ValueStore<T> {
  const [gate] = useState<ValueStore<T>>((): ValueStore<T> => createValueStore<T>(context, value));
  useEffect((): void => gate.set(value), [gate, value]);
  return gate;
}
