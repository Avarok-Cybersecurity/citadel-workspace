/**
 * The page's live-instance budget (design 2.3: at most 8 per page; zones beyond it show "Click to
 * activate"). One object per page, created by whoever mounts apps, with the cap passed in.
 */
export class InstanceSlots {
  private live: number = 0;

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max <= 0) throw new Error(`instance slots: max must be a positive integer, got ${max}`);
  }

  get inUse(): number {
    return this.live;
  }

  /** A release function, or null when the page is at its cap. Releasing twice is a no-op. */
  acquire(): (() => void) | null {
    if (this.live >= this.max) return null;
    this.live++;
    let released: boolean = false;
    return (): void => {
      if (released) return;
      released = true;
      this.live--;
    };
  }
}
