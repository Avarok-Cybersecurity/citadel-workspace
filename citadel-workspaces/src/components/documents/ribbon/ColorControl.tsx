/**
 * Text colour and highlight: the platform's own colour picker (any sRGB colour, which is the
 * model's `#RRGGBB`), applied when the picker is closed on a colour, not on every drag step.
 * The strip under the icon shows the caret's colour, or a hatch when it is not known.
 */
import { useEffect, useRef, type MouseEvent, type MutableRefObject, type RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { HexColor } from '@/lib/cdoc/editor/model-values';
import { cn } from '@/lib/utils';
import { RibbonTip, RIBBON_CONTROL } from './RibbonButton';
import { useRibbon } from './ribbon-context';

export interface ColorControlProps {
  readonly testId: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** The caret's colour, or null when not known. */
  readonly value: HexColor | null;
  readonly onPick: (color: HexColor) => void;
}

const HEX: RegExp = /^#[0-9a-f]{6}$/i;

export function ColorControl({ testId, label, icon: Icon, value, onPick }: ColorControlProps): JSX.Element {
  const { disabledReason } = useRibbon();
  const input: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  const latest: MutableRefObject<{ pick: (color: HexColor) => void; reason: string | null }> = useRef({ pick: onPick, reason: disabledReason });
  useEffect((): void => { latest.current = { pick: onPick, reason: disabledReason }; });

  // React's onChange on a colour input fires for every drag step; `change` fires once, on commit.
  useEffect((): (() => void) => {
    const el: HTMLInputElement | null = input.current;
    const onChange: () => void = (): void => {
      const color: string = el?.value ?? '';
      if (latest.current.reason === null && HEX.test(color)) latest.current.pick(color.toUpperCase() as HexColor);
    };
    el?.addEventListener('change', onChange);
    return (): void => el?.removeEventListener('change', onChange);
  }, []);

  return (
    <RibbonTip label={label} reason={disabledReason}>
      <label className={cn(RIBBON_CONTROL, 'relative flex-col gap-0 focus-within:ring-2 focus-within:ring-ring')} aria-disabled={disabledReason !== null}>
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        <span
          aria-hidden="true"
          data-testid={`${testId}-swatch`}
          className={cn('mt-0.5 h-[4px] w-[20px] rounded-sm', value === null && 'bg-[repeating-linear-gradient(90deg,hsl(var(--muted-foreground))_0_2px,transparent_2px_4px)]')}
          style={value === null ? undefined : { backgroundColor: value }}
        />
        <input
          ref={input}
          type="color"
          data-roving-item=""
          data-testid={testId}
          aria-label={label}
          aria-disabled={disabledReason !== null}
          // Not `disabled`: that would drop it from the roving order. A refused click opens no picker.
          onClick={(e: MouseEvent<HTMLInputElement>): void => { if (disabledReason !== null) e.preventDefault(); }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 aria-disabled:cursor-not-allowed"
        />
      </label>
    </RibbonTip>
  );
}
