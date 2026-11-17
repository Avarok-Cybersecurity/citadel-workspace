/**
 * The preset colour swatches for a group role.
 *
 * Extracted from GroupRoleEditor, which crossed the 250-line cap when these
 * buttons were finally given names. They were N identical empty buttons --
 * "button", "button", "button" to a screen reader -- with the selected one
 * marked by a ring, which is colour and shape and nothing else.
 */

import { Label } from '@/components/ui/label';

import { PRESET_COLORS } from './GroupRoleEditorConstants';

interface RoleColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export function RoleColorPicker({ color, onChange }: RoleColorPickerProps): JSX.Element {
  return (
  <div className="space-y-2">
    <Label className="text-sm text-foreground/80">Role Color (optional)</Label>
    <div className="flex flex-wrap gap-2">
      {PRESET_COLORS.map(presetColor => (
        /* Named and stateful. These were N identical empty buttons --
           "button", "button", "button" -- and the selected one was
           marked by a ring, which is colour and shape only. */
        <button
          key={presetColor}
          type="button"
          onClick={() => onChange(presetColor)}
          aria-label={`Role colour ${presetColor}`}
          aria-pressed={color === presetColor}
          className={`w-7 h-7 rounded-full transition-all ${
            color === presetColor
              ? 'ring-2 ring-offset-2 ring-offset-background ring-ring'
              : 'hover:scale-110'
          }`}
          style={{ backgroundColor: presetColor }}
        />
      ))}
      <button
        type="button"
        aria-label="No role colour"
        aria-pressed={!color}
        onClick={() => onChange('')}
        className={`w-7 h-7 rounded-full border-2 border-dashed border-border text-xs text-muted-foreground ${
          !color ? 'ring-2 ring-offset-2 ring-offset-background ring-ring' : ''
        }`}
        title="No color"
      >
        ✕
      </button>
    </div>
  </div>
  );
}
