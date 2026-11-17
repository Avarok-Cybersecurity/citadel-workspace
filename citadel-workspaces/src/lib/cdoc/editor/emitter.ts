/**
 * A typed event emitter: one listener set per event name, `on` returns the unsubscribe. A
 * listener that throws is reported and does not stop the others or the emitter's caller.
 */
export class Emitter<Events extends object> {
  private readonly listeners: Map<keyof Events, Set<(payload: never) => void>> = new Map<keyof Events, Set<(payload: never) => void>>();

  on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): () => void {
    let set: Set<(payload: never) => void> | undefined = this.listeners.get(event);
    if (set === undefined) this.listeners.set(event, (set = new Set<(payload: never) => void>()));
    set.add(listener as (payload: never) => void);
    return (): void => {
      set.delete(listener as (payload: never) => void);
    };
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        (listener as (payload: Events[E]) => void)(payload);
      } catch (error: unknown) {
        console.error(`cdoc editor: a '${String(event)}' listener threw`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
