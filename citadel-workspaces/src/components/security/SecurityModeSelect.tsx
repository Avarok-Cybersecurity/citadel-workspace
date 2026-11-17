import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpHint } from "@/components/shared/HelpHint";
import { Label } from "@/components/ui/label";
import { SecrecyMode } from "@/types";

interface SecurityModeSelectProps {
  value?: SecrecyMode;
  onChange?: (value: SecrecyMode) => void;
}

export const SecurityModeSelect = ({ value = 'BestEffort', onChange }: SecurityModeSelectProps): JSX.Element => {
  const handleValueChange = (newValue: SecrecyMode): void => {
    if (onChange) {
      onChange(newValue);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Label htmlFor="security-mode" className="text-foreground/80">
          Security Mode
        </Label>
        <HelpHint topic="Security Mode">Choose your preferred security mode for encrypted communications</HelpHint>
      </div>
      <div className="relative">
        <Select 
          value={value} 
          onValueChange={handleValueChange}
          defaultValue={'BestEffort'}
        >
          <SelectTrigger id="security-mode" className="w-full bg-surface text-foreground">
            <SelectValue placeholder="Select security mode" />
          </SelectTrigger>
          <SelectContent className="bg-card border border-primary-accent/30 text-foreground shadow-xl p-1">
            <SelectItem value={'BestEffort'} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm">Best Effort Secrecy</SelectItem>
            <SelectItem value={'Perfect'} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm">Perfect Forward Secrecy</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};