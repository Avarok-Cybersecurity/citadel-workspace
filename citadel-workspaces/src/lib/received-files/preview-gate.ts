/**
 * Bounds what picture previews hold at once: reads and decodes run in arrival order, each holding
 * its reservation until it ends, never more than the cap in total and never two RAW files. Pure.
 */
import type { PreviewReservation } from './image-preview';

export interface PreviewGate {
  run<T>(reservation: PreviewReservation, task: () => Promise<T>): Promise<T>;
}

interface Waiting {
  readonly reservation: PreviewReservation;
  readonly start: () => void;
}

export function createPreviewGate(capBytes: bigint): PreviewGate {
  let held: bigint = 0n;
  let rawHeld: boolean = false;
  const waiting: Waiting[] = [];

  const fits = (r: PreviewReservation): boolean => held + r.bytes <= capBytes && !(r.raw && rawHeld);

  const admit = (): void => {
    while (waiting.length > 0 && fits(waiting[0].reservation)) {
      const next: Waiting = waiting.shift() as Waiting;
      held += next.reservation.bytes;
      if (next.reservation.raw) rawHeld = true;
      next.start();
    }
  };

  const release = (r: PreviewReservation): void => {
    held -= r.bytes;
    if (r.raw) rawHeld = false;
    admit();
  };

  return {
    run<T>(reservation: PreviewReservation, task: () => Promise<T>): Promise<T> {
      if (reservation.bytes > capBytes) {
        return Promise.reject(new Error(`a preview of ${reservation.bytes} bytes can never fit under ${capBytes}`));
      }
      const admitted: Promise<void> = new Promise<void>((start: () => void): void => {
        waiting.push({ reservation, start });
        admit();
      });
      return admitted.then(task).finally((): void => release(reservation));
    },
  };
}
