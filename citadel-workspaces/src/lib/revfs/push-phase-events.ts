/**
 * Where a RE-VFS push stands, told to whoever shows it. The push is named by the `pushId` its
 * caller gave the `backend-send-file` intent (the file's id), since the request id it travels
 * under is made inside the network layer and is never seen by the page that started it.
 */
import { eventEmitter } from '@/lib/event-emitter';
import type { PushPhase } from './push-watch';

const PUSH_PHASE_EVENT: string = 'revfs-push-phase';

interface PushPhaseEvent {
  readonly pushId: string;
  readonly phase: PushPhase;
}

export function emitPushPhase(pushId: string, phase: PushPhase): void {
  eventEmitter.emit<PushPhaseEvent>(PUSH_PHASE_EVENT, { pushId, phase });
}

/** Hear `pushId`'s phases until the returned function is called. */
export function onPushPhase(pushId: string, listener: (phase: PushPhase) => void): () => void {
  const handler = (event: PushPhaseEvent): void => {
    if (event.pushId === pushId) listener(event.phase);
  };
  return eventEmitter.on<PushPhaseEvent>(PUSH_PHASE_EVENT, handler);
}
