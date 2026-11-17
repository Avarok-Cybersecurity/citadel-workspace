/** A seeded PRNG (mulberry32), so a failing property run is reproduced by its seed. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t: number = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(below: number): number {
    return Math.floor(this.next() * below);
  }

  chance(p: number): boolean {
    return p > 0 && this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  shuffle<T>(items: T[]): void {
    for (let i: number = items.length - 1; i > 0; i -= 1) {
      const j: number = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}
