import { cn } from '@/lib/utils';
import type { ThemePalette, ThemeTokenKey, WorkspaceIcon } from '@/lib/theme/theme-types';
import { toCssColor } from '@/lib/theme/hsl';
import { PREVIEW_REGIONS , type PreviewRegion } from '@/lib/theme/preview-regions';
import type { CSSProperties, ButtonHTMLAttributes } from 'react';

interface ThemePreviewProps {
  palette: ThemePalette;
  icon: WorkspaceIcon;
  radius: number;
  workspaceName: string;
  selectedToken: ThemeTokenKey | null;
  onSelectToken: (token: ThemeTokenKey) => void;
}

/**
 * A miniature of the real workspace, where every part is the control that edits
 * its own colour.
 *
 * This IS the editor. A list of 26 named swatches would be faster to build and
 * far worse to use — "surface" and "accent" mean nothing until you see which
 * thing they paint. Clicking the sidebar in a picture of your workspace does not
 * need explaining.
 *
 * Every region is a real <button>, so the whole editor is keyboard reachable and
 * announced. The depress-on-press is a transform, which the compositor handles
 * without a repaint, and it is suppressed under prefers-reduced-motion.
 *
 * Colours are inline styles from the palette being edited, NOT the app's CSS
 * variables: the preview has to show the theme under construction while the app
 * around it still wears the saved one.
 */
export function ThemePreview({
  palette,
  icon,
  radius,
  workspaceName,
  selectedToken,
  onSelectToken,
}: ThemePreviewProps): JSX.Element {
  const region: (id: string) => PreviewRegion = (id: string): PreviewRegion => PREVIEW_REGIONS.find((r): boolean => r.id === id)!;

  /** Shared behaviour for every clickable part of the mock. */
  const hotspot: (id: string) => { type: "button"; 'data-testid': string; 'data-selected': string | undefined; 'aria-label': string; 'aria-pressed': boolean; title: string; onClick: () => void; className: string; style: CSSProperties | undefined; } = (id: string): { type: "button"; 'data-testid': string; 'data-selected': string | undefined; 'aria-label': string; 'aria-pressed': boolean; title: string; onClick: () => void; className: string; style: CSSProperties | undefined; } => {
    const r: PreviewRegion = region(id);
    const selected: boolean = selectedToken === r.token;
    return {
      type: 'button' as const,
      'data-testid': `preview-region-${id}`,
      'data-selected': selected ? 'true' : undefined,
      'aria-label': `Edit ${r.label}`,
      'aria-pressed': selected,
      title: `${r.label} — ${r.description}`,
      onClick: (): void => onSelectToken(r.token),
      className: cn(
        'relative text-left transition-transform duration-150 ease-out',
        'motion-safe:hover:scale-[0.985] motion-safe:active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        selected && 'ring-2 ring-offset-1',
      ),
      style: selected
        ? ({ '--tw-ring-color': toCssColor(palette.primaryAccent) } as React.CSSProperties)
        : undefined,
    };
  };

  return (
    <div
      data-testid="theme-preview"
      className="overflow-hidden border shadow-sm"
      style={{
        backgroundColor: toCssColor(palette.background),
        borderColor: toCssColor(palette.border),
        borderRadius: `${radius}rem`,
      }}
    >
      {/* Top bar */}
      <button
        {...hotspot('topbar')}
        className={cn(hotspot('topbar').className, 'flex w-full items-center gap-2 border-b px-3 py-2')}
        style={{
          ...hotspot('topbar').style,
          backgroundColor: toCssColor(palette.card),
          borderColor: toCssColor(palette.border),
        }}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-semibold"
          style={{ backgroundColor: toCssColor(icon.color), color: toCssColor(palette.primaryForeground) }}
        >
          {icon.emoji ?? workspaceName.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate text-xs font-medium" style={{ color: toCssColor(palette.foreground) }}>
          {workspaceName}
        </span>
        <span className="ml-auto flex gap-1">
          <Dot color={toCssColor(palette.success)} />
          <Dot color={toCssColor(palette.warning)} />
          <Dot color={toCssColor(palette.destructive)} />
        </span>
      </button>

      <div className="flex" style={{ height: 168 }}>
        {/* Sidebar */}
        <button
          {...hotspot('sidebar')}
          className={cn(hotspot('sidebar').className, 'flex w-24 shrink-0 flex-col gap-1.5 border-r p-2')}
          style={{
            ...hotspot('sidebar').style,
            backgroundColor: toCssColor(palette.surface),
            borderColor: toCssColor(palette.border),
          }}
        >
          <SidebarRow color={toCssColor(palette.mutedForeground)} width="80%" />
          <SidebarRow color={toCssColor(palette.mutedForeground)} width="60%" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
          {/* Selected item */}
          <button
            {...hotspot('active-item')}
            className={cn(hotspot('active-item').className, 'flex items-center gap-1.5 rounded px-2 py-1')}
            style={{ ...hotspot('active-item').style, backgroundColor: toCssColor(palette.primary) }}
          >
            <span className="text-xs font-medium" style={{ color: toCssColor(palette.primaryForeground) }}>
              Selected
            </span>
          </button>

          {/* A message, standing in for content */}
          <div
            className="rounded border p-2"
            style={{ backgroundColor: toCssColor(palette.card), borderColor: toCssColor(palette.border) }}
          >
            <button
              {...hotspot('body-text')}
              className={cn(hotspot('body-text').className, 'block w-full')}
            >
              <span className="block text-xs leading-tight" style={{ color: toCssColor(palette.foreground) }}>
                The quick brown fox
              </span>
            </button>
            <button
              {...hotspot('muted-text')}
              className={cn(hotspot('muted-text').className, 'mt-0.5 block w-full')}
            >
              <span className="block text-xs" style={{ color: toCssColor(palette.mutedForeground) }}>
                09:24 · delivered
              </span>
            </button>
          </div>

          <div className="mt-auto flex items-center gap-1.5">
            <button
              {...hotspot('accent')}
              className={cn(hotspot('accent').className, 'rounded px-2 py-1 text-xs font-medium')}
              style={{ ...hotspot('accent').style, color: toCssColor(palette.primaryAccent) }}
            >
              Accent link
            </button>
            <button
              {...hotspot('destructive')}
              className={cn(hotspot('destructive').className, 'ml-auto rounded px-2 py-1 text-xs font-medium')}
              style={{
                ...hotspot('destructive').style,
                backgroundColor: toCssColor(palette.destructive),
                color: toCssColor(palette.destructiveForeground),
              }}
            >
              Delete
            </button>
          </div>

          {/* Borders and inputs */}
          <button
            {...hotspot('border')}
            className={cn(hotspot('border').className, 'w-full rounded border px-2 py-1 text-left text-xs')}
            style={{
              ...hotspot('border').style,
              borderColor: toCssColor(palette.border),
              color: toCssColor(palette.mutedForeground),
            }}
          >
            Type a message…
          </button>
        </div>
      </div>

      {/* Status colours that have no natural home in the mock, kept reachable */}
      <div
        className="flex items-center gap-2 border-t px-3 py-1.5"
        style={{ borderColor: toCssColor(palette.border), backgroundColor: toCssColor(palette.card) }}
      >
        <SwatchButton hotspot={hotspot('success')} color={toCssColor(palette.success)} label="Success" palette={palette} />
        <SwatchButton hotspot={hotspot('warning')} color={toCssColor(palette.warning)} label="Warning" palette={palette} />
        <button
          {...hotspot('page')}
          className={cn(hotspot('page').className, 'ml-auto rounded px-2 py-0.5 text-xs')}
          style={{ ...hotspot('page').style, color: toCssColor(palette.mutedForeground) }}
        >
          Background
        </button>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }): JSX.Element {
  return <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />;
}

function SidebarRow({ color, width }: { color: string; width: string }): JSX.Element {
  return <span className="h-1.5 rounded-full opacity-60" style={{ backgroundColor: color, width }} />;
}

function SwatchButton({
  hotspot,
  color,
  label,
  palette,
}: {
  hotspot: ReturnType<() => Record<string, unknown>>;
  color: string;
  label: string;
  palette: ThemePalette;
}): JSX.Element {
  const props: ButtonHTMLAttributes<HTMLButtonElement> & { className?: string; } = hotspot as unknown as React.ButtonHTMLAttributes<HTMLButtonElement> & { className?: string };
  return (
    <button
      {...props}
      className={cn(props.className, 'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs')}
      style={{ ...props.style, color: toCssColor(palette.mutedForeground) }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </button>
  );
}
