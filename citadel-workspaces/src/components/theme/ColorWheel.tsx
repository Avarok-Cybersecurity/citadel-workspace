import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent , type RefObject } from 'react';
import { isEnterCommit } from '@/lib/keyboard-commit';
import type { HslColor } from '@/lib/theme/theme-types';
import { toCssColor, toHex, fromHex } from '@/lib/theme/hsl';

interface ColorWheelProps {
  value: HslColor;
  onChange: (color: HslColor) => void;
  /** Accessible name, since the wheel is the control for a specific token. */
  label: string;
}

const SIZE: number = 168;
const RING_THICKNESS: number = 22;
const CENTER: number = SIZE / 2;
const RING_RADIUS: number = CENTER - RING_THICKNESS / 2;

/**
 * Hue ring with a saturation/lightness square inside it.
 *
 * A ring rather than a plain slider because hue is circular — 359 and 1 are
 * neighbours, and a linear control makes that the two far ends, which is
 * exactly where people get lost dialling in a colour.
 *
 * Pointer events (not mouse) so it works under touch and pen without a second
 * code path, with capture so a drag that leaves the element keeps tracking
 * instead of stopping dead.
 *
 * Keyboard support is deliberate rather than decorative: a colour picker
 * reachable only by dragging is unusable with a keyboard or a screen reader, and
 * this is the primary editing control of the whole feature.
 */
export function ColorWheel({ value, onChange, label }: ColorWheelProps): JSX.Element {
  // Typing a hex goes through a draft: parsing on every keystroke would reject
  // "1a2" on the way to "1a2b3c" and fight the user's cursor.
  const [hexDraft, setHexDraft] = useState(() => toHex(value).slice(1));

  useEffect(() => {
    setHexDraft(toHex(value).slice(1));
  }, [value]);

  const commitHex: () => void = useCallback((): void => {
    const parsed: HslColor | null = fromHex(hexDraft);
    if (parsed) onChange(parsed);
    // Invalid input snaps back to the current colour rather than clearing —
    // silently emptying the field would lose the value the user was editing.
    else setHexDraft(toHex(value).slice(1));
  }, [hexDraft, onChange, value]);

  const ringRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const squareRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  const hueFromPointer: (event: ReactPointerEvent<HTMLDivElement>) => void = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect: DOMRect | undefined = ringRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x: number = event.clientX - rect.left - rect.width / 2;
      const y: number = event.clientY - rect.top - rect.height / 2;
      // atan2 gives -180..180 from the positive x axis; shift so 0deg is up,
      // matching where the handle is drawn.
      const degrees: number = (Math.atan2(y, x) * 180) / Math.PI + 90;
      onChange({ ...value, h: (degrees + 360) % 360 });
    },
    [onChange, value],
  );

  const slFromPointer: (event: ReactPointerEvent<HTMLDivElement>) => void = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect: DOMRect | undefined = squareRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x: number = clamp01((event.clientX - rect.left) / rect.width);
      const y: number = clamp01((event.clientY - rect.top) / rect.height);
      onChange({ ...value, s: x * 100, l: (1 - y) * 100 });
    },
    [onChange, value],
  );

  const drag: (handler: (e: ReactPointerEvent<HTMLDivElement>) => void) => { onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void; onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void; onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void; } = (handler: (e: ReactPointerEvent<HTMLDivElement>) => void): { onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void; onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void; onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void; } => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>): void => {
      e.currentTarget.setPointerCapture(e.pointerId);
      handler(e);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) handler(e);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>): void => {
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
  });

  const handleAngle: number = (value.h - 90) * (Math.PI / 180);
  const handleX: number = CENTER + RING_RADIUS * Math.cos(handleAngle);
  const handleY: number = CENTER + RING_RADIUS * Math.sin(handleAngle);

  return (
    <div className="flex flex-col items-center gap-3" data-testid="color-wheel">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {/* Hue ring */}
        <div
          ref={ringRef}
          role="slider"
          tabIndex={0}
          aria-label={`${label} hue`}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(value.h)}
          aria-valuetext={`${Math.round(value.h)} degrees`}
          data-testid="color-wheel-hue"
          className="absolute inset-0 rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{
            background:
              'conic-gradient(from 0deg, hsl(0 90% 55%), hsl(60 90% 55%), hsl(120 90% 55%), hsl(180 90% 55%), hsl(240 90% 55%), hsl(300 90% 55%), hsl(360 90% 55%))',
            // Punch the middle out so the ring reads as a ring and the square
            // inside stays clickable.
            mask: `radial-gradient(circle, transparent ${CENTER - RING_THICKNESS}px, #000 ${CENTER - RING_THICKNESS + 1}px)`,
            WebkitMask: `radial-gradient(circle, transparent ${CENTER - RING_THICKNESS}px, #000 ${CENTER - RING_THICKNESS + 1}px)`,
          }}
          onKeyDown={(e) => {
            const step: 10 | 1 = e.shiftKey ? 10 : 1;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              onChange({ ...value, h: (value.h + step) % 360 });
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              onChange({ ...value, h: (value.h - step + 360) % 360 });
            }
          }}
          {...drag(hueFromPointer)}
        />

        {/* Hue handle */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: handleX, top: handleY, backgroundColor: toCssColor({ h: value.h, s: 90, l: 55 }) }}
        />

        {/* Saturation / lightness square */}
        <div
          ref={squareRef}
          role="slider"
          tabIndex={0}
          aria-label={`${label} saturation and lightness`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(value.l)}
          aria-valuetext={`${Math.round(value.s)}% saturation, ${Math.round(value.l)}% lightness`}
          data-testid="color-wheel-square"
          className="absolute rounded-md cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            inset: RING_THICKNESS + 10,
            background: `
              linear-gradient(to top, hsl(0 0% 0%), transparent),
              linear-gradient(to right, hsl(0 0% 50%), ${toCssColor({ h: value.h, s: 100, l: 50 })})
            `,
          }}
          onKeyDown={(e) => {
            const step: 10 | 2 = e.shiftKey ? 10 : 2;
            const moves: Record<string, Partial<HslColor>> = {
              ArrowRight: { s: Math.min(100, value.s + step) },
              ArrowLeft: { s: Math.max(0, value.s - step) },
              ArrowUp: { l: Math.min(100, value.l + step) },
              ArrowDown: { l: Math.max(0, value.l - step) },
            };
            const move: Partial<HslColor> = moves[e.key];
            if (move) {
              e.preventDefault();
              onChange({ ...value, ...move });
            }
          }}
          {...drag(slFromPointer)}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{
              left: `${value.s}%`,
              top: `${100 - value.l}%`,
              backgroundColor: toCssColor(value),
            }}
          />
        </div>
      </div>

      {/* Direct entry, for when you already know the colour.
          The wheel is for exploring; this is for reproducing a brand hex exactly,
          which dragging cannot do reliably. */}
      <div className="flex w-full items-center gap-2">
        <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border">
          <span className="sr-only">{label} colour picker</span>
          <input
            type="color"
            data-testid="color-wheel-native"
            value={toHex(value)}
            onChange={(e) => {
              const parsed: HslColor | null = fromHex(e.target.value);
              if (parsed) onChange(parsed);
            }}
            // The native swatch is unstyleable across browsers, so it is scaled
            // out of view and the label's own background shows the colour.
            className="absolute -inset-2 h-[200%] w-[200%] cursor-pointer border-0 p-0"
          />
          <span className="pointer-events-none absolute inset-0" style={{ backgroundColor: toCssColor(value) }} />
        </label>

        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">#</span>
          <input
            type="text"
            inputMode="text"
            spellCheck={false}
            aria-label={`${label} hex value`}
            data-testid="color-wheel-hex"
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value.replace(/^#/, ''))}
            onBlur={commitHex}
            onKeyDown={(e) => {
              if (isEnterCommit(e)) {
                e.preventDefault();
                commitHex();
              }
            }}
            className="h-8 w-full rounded-md border border-border bg-input pl-5 pr-2 font-mono text-xs uppercase text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
