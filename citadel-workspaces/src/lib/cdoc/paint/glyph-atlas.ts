/**
 * The glyph atlas: each (face, glyph, pixel size, quarter-pixel phase, colour) rasterised once
 * into a cell of a shared surface, then copied 1:1 with drawImage on every later paint.
 *
 * Cells come in fixed size classes, one surface per class, created on first use. A class that
 * is full evicts its least recently used glyph (a Map's insertion order is the LRU order: a
 * hit re-inserts). A glyph too big for the largest class is filled straight from its Path2D.
 */
import type { CanvasPort, Ctx2D, Surface } from './canvas-port';
import type { PreparedGlyph } from './glyph-outlines';

export interface AtlasConfig {
  /** Ascending cell edge lengths in device px, e.g. [16, 32, 64, 128]. */
  readonly cellSizes: readonly number[];
  /** Each class's surface edge in device px; capacity is (side / cell)². */
  readonly surfaceSide: number;
}

export interface AtlasStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  /** Glyphs filled from their path because no cell class could hold them. */
  readonly direct: number;
}

export interface GlyphDraw {
  readonly glyph: PreparedGlyph;
  readonly unitsPerEm: number;
  /** Font size in device px, already quantised by the caller. */
  readonly sizePx: number;
  /** Pen x in device px, quarter-pixel quantised. */
  readonly x: number;
  /** Baseline y in whole device px. */
  readonly y: number;
  readonly color: string;
}

const PAD: number = 1;

interface SizeClass {
  readonly cell: number;
  readonly perRow: number;
  readonly capacity: number;
  surface: Surface | null;
  /** Glyph key → cell index; iteration order is least recently used first. */
  readonly lru: Map<string, number>;
}

export class GlyphAtlas {
  private readonly classes: SizeClass[];
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;
  private direct: number = 0;

  constructor(private readonly port: CanvasPort, config: AtlasConfig) {
    this.classes = config.cellSizes.map((cell: number): SizeClass => {
      const perRow: number = Math.floor(config.surfaceSide / cell);
      if (perRow < 1) throw new RangeError(`atlas cell ${cell} does not fit a ${config.surfaceSide}px surface`);
      return { cell, perRow, capacity: perRow * perRow, surface: null, lru: new Map<string, number>() };
    });
  }

  stats(): AtlasStats {
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, direct: this.direct };
  }

  draw(target: Ctx2D, d: GlyphDraw): void {
    const path: Path2D | null = d.glyph.path;
    if (path === null) return;
    const s: number = d.sizePx / d.unitsPerEm;
    const ix: number = Math.floor(d.x);
    const phase: number = d.x - ix;
    const o: PreparedGlyph['outline'] = d.glyph.outline;
    const left: number = Math.floor(o.xMin * s);
    const top: number = Math.ceil(o.yMax * s);
    const need: number = Math.max(Math.ceil(o.xMax * s) - left + 1, top - Math.floor(o.yMin * s)) + 2 * PAD;
    const sizeClass: SizeClass | undefined = this.classes.find((c: SizeClass): boolean => c.cell >= need);
    if (sizeClass === undefined) {
      this.direct++;
      fillGlyph(target, path, s, d.x, d.y, d.color);
      return;
    }
    const ox: number = PAD - left;
    const oy: number = PAD + top;
    const key: string = `${d.glyph.faceId}:${d.glyph.glyphId}:${d.sizePx}:${phase}:${d.color}`;
    let index: number | undefined = sizeClass.lru.get(key);
    if (index !== undefined) {
      this.hits++;
      sizeClass.lru.delete(key);
    } else {
      this.misses++;
      index = this.takeCell(sizeClass);
      const surface: Surface = this.surfaceOf(sizeClass);
      const [cx, cy] = cellOrigin(sizeClass, index);
      surface.ctx.clearRect(cx, cy, sizeClass.cell, sizeClass.cell);
      fillGlyph(surface.ctx, path, s, cx + ox + phase, cy + oy, d.color);
    }
    sizeClass.lru.set(key, index);
    const [sx, sy] = cellOrigin(sizeClass, index);
    target.drawImage(this.surfaceOf(sizeClass).image, sx, sy, sizeClass.cell, sizeClass.cell, ix - ox, d.y - oy, sizeClass.cell, sizeClass.cell);
  }

  private takeCell(c: SizeClass): number {
    // Every entry owns one cell and cells are only ever reused by eviction, so while the class
    // has room the next unused cell is the entry count.
    if (c.lru.size < c.capacity) return c.lru.size;
    const oldest: [string, number] = c.lru.entries().next().value as [string, number];
    c.lru.delete(oldest[0]);
    this.evictions++;
    return oldest[1];
  }

  private surfaceOf(c: SizeClass): Surface {
    if (c.surface === null) c.surface = this.port.createSurface(c.perRow * c.cell, c.perRow * c.cell);
    return c.surface;
  }
}

function cellOrigin(c: SizeClass, index: number): [number, number] {
  return [(index % c.perRow) * c.cell, Math.floor(index / c.perRow) * c.cell];
}

/** Fills an outline (font units, y up) at a device-px pen: scale by s, flip y. */
function fillGlyph(ctx: Ctx2D, path: Path2D, s: number, x: number, y: number, color: string): void {
  ctx.save();
  ctx.setTransform(s, 0, 0, -s, x, y);
  ctx.fillStyle = color;
  ctx.fill(path, 'nonzero');
  ctx.restore();
}
