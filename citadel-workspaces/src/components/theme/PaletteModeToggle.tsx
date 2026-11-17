/**
 * Chooser for WHICH PALETTE the appearance editor is editing (light or dark),
 * with the "Match light" re-derive affordance for the dark palette.
 *
 * Split from WorkspaceAppearanceModal.tsx as its own control: it carries the
 * accessibility decision that this is a radiogroup rather than Tabs (see the
 * inline comment), which deserves to live with the control it shapes.
 */

import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { RotateCcw, Sun, Moon } from 'lucide-react';
import type { ThemeMode } from '@/lib/theme/theme-types';

interface PaletteModeToggleProps {
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
  /** True when the dark palette has drifted from the light one and the viewer may reset it. */
  showRederive: boolean;
  onRederive: () => void;
}

export function PaletteModeToggle({ mode, onModeChange, showRederive, onRederive }: PaletteModeToggleProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {/* A radiogroup, not Tabs. These pick WHICH PALETTE you are
          editing — they do not switch panels, and there was no
          TabsContent for them to control, so Radix emitted
          aria-controls pointing at an element that never existed. That
          is a dangling reference for a screen reader, and axe rates it
          critical.

          The labels say "palette" for the same reason: this does not
          change the reader's own light/dark preference, which is a
          separate control in settings and stays theirs. */}
      <RadioGroup
        value={mode}
        onValueChange={(v) => onModeChange(v as ThemeMode)}
        aria-label="Palette to edit"
        className="flex items-center gap-1 rounded-md bg-muted p-1"
        data-testid="appearance-mode-tabs"
      >
        {(
          [
            { value: 'light' as const, label: 'Light palette', Icon: Sun },
            { value: 'dark' as const, label: 'Dark palette', Icon: Moon },
          ]
        ).map(({ value, label, Icon }) => (
          <label
            key={value}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
              mode === value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {/* Named on the ITEM. Radix renders a <button role="radio">, and
                a wrapping <label> does not name a button -- the accname comes
                from the button's own subtree, which sr-only leaves empty. Both
                options announced as "radio, not checked". */}
            <RadioGroupItem
              value={value}
              aria-label={label}
              className="sr-only"
              data-testid={`appearance-mode-${value}`}
            />
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </label>
        ))}
      </RadioGroup>

      {showRederive && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="appearance-rederive-dark"
          onClick={onRederive}
          title="Recompute the dark palette from the light one"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Match light
        </Button>
      )}
    </div>
  );
}
