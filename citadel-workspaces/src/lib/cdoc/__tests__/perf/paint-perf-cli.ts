/** Run by scripts/check-cdoc-paint-perf.mjs through vite-node; prints the measurements. */
import { measurePaint, type PaintPerf } from './paint-perf';
import { measureKeystrokes, type KeystrokePerf } from './keystroke-perf';
import { measureSelectAll, type SelectAllPerf } from './select-all-perf';
import { measureImagePage, type ImagePagePerf } from './image-perf';

const [runs, zoom, dpr]: number[] = process.argv.slice(2).map(Number);
const r: PaintPerf = await measurePaint(runs, zoom, dpr);
console.log(`${r.pages} pages, ${r.bytes} bytes, zoom ${zoom}, dpr ${dpr}`);
console.log(`decode (open + every page body), median of ${runs}: ${r.decodeMs.toFixed(2)} ms`);
console.log(`glyph outlines for every page (wasm glyph_path + Path2D): ${r.outlineMs.toFixed(2)} ms`);
console.log(`first page paint, cold atlas: ${r.firstPaintMs.toFixed(2)} ms`);
console.log(`every page after the first: ${r.allPagesPaintMs.toFixed(2)} ms`);
console.log(`atlas ${JSON.stringify(r.atlas)}, hit rate ${(100 * r.hitRate).toFixed(2)}%`);

const k: KeystrokePerf = await measureKeystrokes(100, 200);
console.log(`keystroke to paint, ${k.pages}-page document, ${k.keystrokes} keystrokes mid-document: p50 ${k.p50Ms.toFixed(2)} ms, p95 ${k.p95Ms.toFixed(2)} ms`);
console.log(`  of which the apply round trip alone, p50: ${k.applyP50Ms.toFixed(2)} ms; dirty pages per keystroke: ${k.dirtyPagesPerKeystroke.toFixed(2)}`);

const all: SelectAllPerf = await measureSelectAll(500, 20);
console.log(`select all, ${all.pages}-page document, viewport set: p50 ${all.withViewport.p50Ms.toFixed(2)} ms, p95 ${all.withViewport.p95Ms.toFixed(2)} ms, ${all.withViewport.rects} rects`);
console.log(`  control, no viewport: p50 ${all.withoutViewport.p50Ms.toFixed(2)} ms, p95 ${all.withoutViewport.p95Ms.toFixed(2)} ms, ${all.withoutViewport.rects} rects`);

const img: ImagePagePerf = await measureImagePage(200, true);
const imgControl: ImagePagePerf = await measureImagePage(200, false);
console.log(`keystroke to paint on a page with images: p50 ${img.p50Ms.toFixed(2)} ms, p95 ${img.p95Ms.toFixed(2)} ms, ${img.decodesPerKeystroke.toFixed(2)} decodes per keystroke`);
console.log(`  control, no image cache: p50 ${imgControl.p50Ms.toFixed(2)} ms, p95 ${imgControl.p95Ms.toFixed(2)} ms, ${imgControl.decodesPerKeystroke.toFixed(2)} decodes per keystroke`);
