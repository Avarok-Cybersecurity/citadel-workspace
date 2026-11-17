/**
 * PSK Dialog for AdvancedSettings.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  psk: string;
  onPskChange: (value: string) => void;
  onSave: () => void;
}

export const PskDialog = ({ open, onOpenChange, psk, onPskChange, onSave }: PskDialogProps): JSX.Element => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card text-foreground border-surface">
        <DialogHeader>
          <DialogTitle>Enter Pre-Shared Key (PSK)</DialogTitle>
          <DialogDescription className="text-foreground/80">
            Please enter your PSK for header obfuscation.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          placeholder="Enter your PSK"
          value={psk}
          onChange={(e) => onPskChange(e.target.value)}
          className="bg-surface border-border text-foreground"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-foreground hover:bg-primary-accent/20"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={onSave}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
