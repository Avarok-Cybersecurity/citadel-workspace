import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface ExitConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  userName: string;
  workspaceName?: string;
}

export const ExitConfirmModal = ({
  open,
  onOpenChange,
  onConfirm,
  userName,
  workspaceName = "your workspace",
}: ExitConfirmModalProps): JSX.Element => {
  const handleConfirm = (): void => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background border-border text-foreground max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary">
              <ArrowLeft className="w-6 h-6 text-foreground" />
            </div>
            <DialogTitle className="text-xl font-semibold text-foreground">
              Exit Workspace?
            </DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground mt-4">
            Return to the landing page? You'll stay logged in as{" "}
            <span className="font-semibold text-primary-accent">{userName}</span>{" "}
            and can access{" "}
            <span className="font-semibold text-primary-accent">{workspaceName}</span>{" "}
            anytime from the workspace switcher.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 p-4 bg-input rounded-lg border border-border">
          <p className="text-sm text-foreground/80">
            💡 <strong>Tip:</strong> Your session will remain active. Click the
            workspace icon on the landing page to return instantly without
            re-entering your password.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="bg-transparent border-border text-foreground/80 hover:bg-accent hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Exit to Landing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
