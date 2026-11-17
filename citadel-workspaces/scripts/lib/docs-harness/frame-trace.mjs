/**
 * Where each frame of a measured pass went, from a Chrome trace: the page marks every frame
 * (`performance.mark('cdoc-frame')`), and the main thread's and the workers' trace events are
 * cut at those marks. Per frame: its duration, how long each thread was busy, and what ran on
 * the main thread, by trace event name, with script calls named by function and source.
 *
 * Nothing in the page is instrumented for this: the marks are the measuring loop's own, and the
 * rest is the browser's trace.
 */

export const FRAME_MARK = 'cdoc-frame';

const CATEGORIES = [
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8',
  'disabled-by-default-v8.gc',
];

/** Starts tracing on `cdp`; the returned function stops it and resolves to the trace events. */
export async function startTrace(cdp) {
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: CATEGORIES } });
  return async () => {
    const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await done;
    let text = '';
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle: stream });
      text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
      if (chunk.eof) break;
    }
    await cdp.send('IO.close', { handle: stream });
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.traceEvents;
  };
}

function threadsOf(events) {
  const names = new Map();
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  }
  return names;
}

/** What a main-thread event is called in the breakdown: a script call by its function and file. */
function labelOf(e) {
  const data = e.args?.data;
  if (e.name === 'FunctionCall' && data !== undefined) {
    const file = (data.url ?? '').split('/').pop() || '(inline)';
    return `call ${data.functionName || '(anonymous)'} ${file}:${data.lineNumber ?? '?'}`;
  }
  return e.name;
}

const add = (into, key, ms) => { into[key] = (into[key] ?? 0) + ms; };

/**
 * Per frame `i` (from mark `i` to mark `i + 1`): `ms`, the main thread's and every worker's busy
 * time (top-level tasks, clipped to the frame), and `main`, the main thread's time by event.
 */
export function framesOf(events) {
  const threads = threadsOf(events);
  const marks = events.filter((e) => e.name === FRAME_MARK && (e.ph === 'R' || e.ph === 'I' || e.ph === 'n' || e.ph === 'b')).map((e) => e.ts).sort((a, b) => a - b);
  if (marks.length < 2) throw new Error(`the trace holds ${marks.length} frame marks`);
  const markThread = events.find((e) => e.name === FRAME_MARK);
  const mainKey = `${markThread.pid}:${markThread.tid}`;
  const frames = marks.slice(0, -1).map((start, i) => ({ i, ms: (marks[i + 1] - start) / 1000, mainBusy: 0, workerBusy: 0, main: {} }));
  const frameAt = (ts) => {
    let lo = 0;
    let hi = marks.length - 2;
    if (ts < marks[0] || ts >= marks[marks.length - 1]) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid] <= ts) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    const key = `${e.pid}:${e.tid}`;
    const thread = threads.get(key) ?? '';
    const isMain = key === mainKey;
    const isWorker = thread.startsWith('DedicatedWorker');
    if (!isMain && !isWorker) continue;
    // A task is cut at frame edges, so a long one counts in each frame it spans.
    for (let f = Math.max(0, frameAt(e.ts)); f >= 0 && f < frames.length && marks[f] < e.ts + e.dur; f++) {
      const ms = (Math.min(e.ts + e.dur, marks[f + 1]) - Math.max(e.ts, marks[f])) / 1000;
      if (ms <= 0) continue;
      if (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') {
        if (isMain) frames[f].mainBusy += ms; else frames[f].workerBusy += ms;
      } else if (isMain) {
        add(frames[f].main, labelOf(e), ms);
      }
    }
  }
  return frames;
}

/** The main thread's mean time per frame by event, in long frames against the rest; top `n`. */
export function contrast(frames, isLong, n) {
  const sum = (list) => {
    const into = {};
    for (const f of list) for (const [k, ms] of Object.entries(f.main)) add(into, k, ms);
    return into;
  };
  const long = frames.filter(isLong);
  const rest = frames.filter((f) => !isLong(f));
  const l = sum(long);
  const r = sum(rest);
  const mean = (list, key) => list.reduce((s, f) => s + f[key], 0) / Math.max(1, list.length);
  return {
    long: long.length,
    rest: rest.length,
    mainBusy: [mean(long, 'mainBusy'), mean(rest, 'mainBusy')],
    workerBusy: [mean(long, 'workerBusy'), mean(rest, 'workerBusy')],
    top: Object.entries(l).map(([k, ms]) => [k, ms / Math.max(1, long.length), (r[k] ?? 0) / Math.max(1, rest.length)])
      .sort((a, b) => b[1] - b[2] - (a[1] - a[2])).slice(0, n),
    longAt: long.map((f) => f.i),
  };
}
