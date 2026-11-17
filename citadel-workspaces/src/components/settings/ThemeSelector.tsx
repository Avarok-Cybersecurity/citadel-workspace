import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Label } from '@/components/ui/label';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

/**
 * Theme picker.
 *
 * `next-themes` resolves the active theme on the client, so the first render on
 * the server (or before hydration) does not know it. Rendering the control only
 * after mount avoids showing the wrong option selected for a frame, which is the
 * standard next-themes hydration caveat.
 *
 * A radiogroup rather than three buttons: this is one setting with three mutually
 * exclusive values, and the roles make that relationship available to a screen
 * reader instead of leaving it implied by the styling.
 */
export function ThemeSelector(): JSX.Element {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-sm font-medium">
        <Sun className="h-4 w-4" aria-hidden="true" />
        Theme
      </Label>
      <p className="text-xs text-muted-foreground">
        Choose a colour scheme, or follow your operating system.
      </p>

      <div role="radiogroup" aria-label="Colour theme" className="flex gap-2 pt-1">
        {OPTIONS.map(({ value, label, Icon }) => {
          // Before mount the active theme is unknown; marking nothing selected is
          // honest, where guessing would briefly highlight the wrong option.
          const selected: boolean = mounted && theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={[
                'flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                // text-foreground, not text-primary-foreground. The latter is
                // WHITE -- it is the foreground that belongs on the SOLID
                // --primary fill, and it is only ever correct there. Here the
                // fill is `bg-primary/10`, a 10% tint, so on the settings
                // dialog's `bg-background` it composites to near-white and the
                // label and sun icon measured 1.17:1. Dark mode hid it, because
                // there the page text is already near-white -- the same reason
                // the sidebar tree carried this bug until TreeNodeItem was fixed.
                // The tint and the border carry "selected"; the text just has to
                // be readable, which at 13.08:1 it now is in both themes.
                selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-surface hover:text-foreground',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
