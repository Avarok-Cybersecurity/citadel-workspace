import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpHint } from "@/components/shared/HelpHint";
import { Label } from "@/components/ui/label";
import { SecurityLevel } from "@/types";
import { securityLevelName, securityLevelValue } from "@/lib/account-levels";

interface SecurityLevelSelectProps {
  value?: SecurityLevel;
  onChange?: (value: SecurityLevel | string) => void;
  /** The highest level this account signs in at (account-levels.ts); undefined offers every level. */
  maxLevel?: number;
}

const OFFERED: readonly string[] = ['Standard', 'Reinforced', 'High', 'Extreme'];

export const SecurityLevelSelect = ({ value = 'Standard', onChange, maxLevel }: SecurityLevelSelectProps): JSX.Element => {
  const handleValueChange = (newValue: string): void => {
    if (onChange) {
      onChange(newValue);
    }
  };
  const chosen: string = typeof value === 'string' ? value : 'Standard';
  const exceeds = (level: string): boolean => maxLevel !== undefined && (securityLevelValue(level) ?? 0) > maxLevel;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Label htmlFor="security-level" className="text-foreground/80">
          Security Level
        </Label>
        <HelpHint topic="Security Level">Select the security level for your workspace</HelpHint>
      </div>
      <div className="relative">
        <Select
          value={chosen}
          onValueChange={handleValueChange}
          defaultValue={'Standard'}
        >
          <SelectTrigger id="security-level" className="w-full bg-surface text-foreground" aria-describedby={maxLevel === undefined ? undefined : 'security-level-limit'}>
            <SelectValue placeholder="Select security level" />
          </SelectTrigger>
          <SelectContent className="bg-card border border-primary-accent/30 text-foreground shadow-xl p-1">
            {OFFERED.map((level: string) => (
              <SelectItem key={level} value={level} disabled={exceeds(level)} data-testid={`security-level-${level}`} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm">{level}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {maxLevel !== undefined && (
        <p id="security-level-limit" data-testid="security-level-limit" className={`text-xs ${exceeds(chosen) ? 'text-destructive' : 'text-muted-foreground'}`}>
          This account was registered at {securityLevelName(maxLevel)}, so it signs in at {securityLevelName(maxLevel)} or lower.
        </p>
      )}
    </div>
  );
};
