/**
 * The limits a host enforces on one `CanvasDraw` before painting any of it (canvas-ext-abi.md §1,
 * the Rust `calls/canvas_check.rs`): a `Path` of 2 to 256 points that fills or strokes, a `Region`
 * whose id is 1 to 64 of `[a-z0-9_-]` and whose label is at most 256 characters (code points, as
 * Rust counts `chars()`), at most 512 regions in one frame. A frame that breaks one is refused
 * whole with `Refused::Limit("canvas_draw")`: nothing of it is painted. Pure, so the worker that
 * paints and the page that draws the region overlay judge a frame by the same rules.
 */
import {
  LIMIT_CANVAS_DRAW, MAX_REGIONS_PER_FRAME, PATH_MAX_POINTS, PATH_MIN_POINTS, REGION_ID_MAX_LEN, REGION_LABEL_MAX_CHARS,
} from '../sdk/generated/AbiConstants';
import type { DrawCommand } from '../sdk/generated/DrawCommand';
import { array, type Parsed } from './schema';
import { region } from './wire-schemas';

export type CanvasRegion = Extract<DrawCommand, { region: unknown }>['region'];

/** The corpus's names for the rules (canvas-draw-corpus.json `verdict.rule`), as the Rust host reports them. */
export type CanvasDrawRule = 'path_points' | 'path_paints_nothing' | 'region_id' | 'region_label' | 'too_many_regions';

export type CanvasDrawVerdict =
  | { readonly ok: true; readonly regions: readonly CanvasRegion[] }
  /** `command`: the offending command's index; null for the frame's region count. */
  | { readonly ok: false; readonly rule: CanvasDrawRule; readonly command: number | null };

export const CANVAS_DRAW_REFUSAL: { readonly limit: typeof LIMIT_CANVAS_DRAW } = { limit: LIMIT_CANVAS_DRAW };

const REGION_ID: RegExp = new RegExp(`^[a-z0-9_-]{1,${REGION_ID_MAX_LEN}}$`);

export function isRegionId(id: string): boolean {
  return REGION_ID.test(id);
}

/** Code points, not UTF-16 units: an emoji is one character, as Rust's `chars().count()` reads it. */
export function regionLabelFits(label: string): boolean {
  return [...label].length <= REGION_LABEL_MAX_CHARS;
}

function commandRule(cmd: DrawCommand): CanvasDrawRule | null {
  if ('path' in cmd) {
    const n: number = cmd.path.points.length;
    if (n < PATH_MIN_POINTS || n > PATH_MAX_POINTS) return 'path_points';
    return cmd.path.fill === null && cmd.path.stroke === null ? 'path_paints_nothing' : null;
  }
  if ('region' in cmd) {
    if (!isRegionId(cmd.region.id)) return 'region_id';
    return regionLabelFits(cmd.region.label) ? null : 'region_label';
  }
  return null;
}

/** The first rule the frame breaks, in command order, the region count judged last; else its regions in draw order. */
export function checkCanvasDraw(commands: readonly DrawCommand[]): CanvasDrawVerdict {
  const regions: CanvasRegion[] = [];
  for (let i: number = 0; i < commands.length; i++) {
    const cmd: DrawCommand = commands[i];
    const rule: CanvasDrawRule | null = commandRule(cmd);
    if (rule !== null) return { ok: false, rule, command: i };
    if ('region' in cmd) regions.push(cmd.region);
  }
  if (regions.length > MAX_REGIONS_PER_FRAME) return { ok: false, rule: 'too_many_regions', command: null };
  return { ok: true, regions };
}

/** Whether two frames' region lists are the same, so an unchanged overlay is not sent or rebuilt. */
export function sameRegions(a: readonly CanvasRegion[], b: readonly CanvasRegion[]): boolean {
  return a.length === b.length && a.every((r: CanvasRegion, i: number): boolean => {
    const o: CanvasRegion = b[i];
    return r.id === o.id && r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h && r.label === o.label && r.role === o.role;
  });
}

/**
 * A region list as it crossed from the worker, read again on the page: the shape the wire schema
 * reads and the rules above, or null. The worker already judged it; the page does not take its word.
 */
export function readRegionList(value: unknown): readonly CanvasRegion[] | null {
  const parsed: Parsed<CanvasRegion[]> = array(region)(value);
  if (parsed === null) return null;
  const verdict: CanvasDrawVerdict = checkCanvasDraw(parsed.v.map((r: CanvasRegion): DrawCommand => ({ region: r })));
  return verdict.ok ? verdict.regions : null;
}
