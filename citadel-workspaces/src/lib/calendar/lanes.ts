/**
 * Side-by-side lanes for a day column's timed chips: chips that overlap share the column's
 * width, each in the first lane free when it starts; a cluster of overlapping chips takes as many
 * lanes as it needs at its busiest, and chips outside it keep the whole width.
 */
export interface Timed {
  fromMinute: number;
  toMinute: number;
}

export interface Laned<T> {
  item: T;
  lane: number;
  lanes: number;
}

/** The least height, in minutes, a chip takes in the layout, so a zero-length event still has a lane. */
const MIN_MINUTES: number = 15;

export function layoutLanes<T extends Timed>(items: readonly T[]): Laned<T>[] {
  const sorted: T[] = [...items].sort((a: T, b: T): number => a.fromMinute - b.fromMinute || b.toMinute - a.toMinute);
  const out: Laned<T>[] = [];
  let cluster: Laned<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd: number = -1;
  const close = (): void => {
    for (const laned of cluster) laned.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const end: number = Math.max(item.toMinute, item.fromMinute + MIN_MINUTES);
    if (item.fromMinute >= clusterEnd) close();
    let lane: number = laneEnds.findIndex((laneEnd: number): boolean => laneEnd <= item.fromMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    cluster.push({ item, lane, lanes: 0 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  close();
  return out;
}
