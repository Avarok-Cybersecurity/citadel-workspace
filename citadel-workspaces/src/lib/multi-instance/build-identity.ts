/**
 * Which build this page is running, as the tabs of one browser compare it.
 *
 * People keep tabs open across deploys, so one browser can hold tabs of two builds at once,
 * all on one channel and sharing one agent connection. They have to agree on which of them
 * leads, and that needs an order: `seq` is the build's own clock, the unix seconds at which
 * vite built it (`__BUILD_SEQ__`, vite.config.ts). A later build has a higher seq; the same
 * build in two tabs has the same one.
 *
 * The entry chunk is the build's content identity (deployed-version.ts). The page learns it
 * from main.tsx's `import.meta.url`, after the channel has already started talking, so it is
 * null until main.tsx declares it.
 */
export const BUILD_SEQ: number = __BUILD_SEQ__;

let runningEntry: string | null = null;

/** Called once, from main.tsx, with the entry chunk's URL. */
export function declareRunningEntry(entryUrl: string, origin: string): void {
  runningEntry = new URL(entryUrl, origin).pathname;
}

/** The entry chunk's path, or null before main.tsx has declared it. */
export function declaredEntry(): string | null {
  return runningEntry;
}
