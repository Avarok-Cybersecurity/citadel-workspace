import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

interface ClearAllDialogProps {
  showDialog: boolean;
  setShowDialog: (show: boolean) => void;
  clearAllType: 'standard' | 'revfs';
  dontAskClearAll: boolean;
  setDontAskClearAll: (value: boolean) => void;
  onConfirmClearAll: (type: 'standard' | 'revfs') => void;
}

export const ClearAllDialog = ({
  showDialog,
  setShowDialog,
  clearAllType,
  dontAskClearAll,
  setDontAskClearAll,
  onConfirmClearAll,
}: ClearAllDialogProps) => {
  return (
    <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
      <AlertDialogContent className="bg-[#444A6C] border-[#262C4A] text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all files?</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-300">
            This action cannot be undone. This will permanently delete all {clearAllType} files.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center space-x-2 py-4">
          <Checkbox
            id="dontAskClearAll"
            checked={dontAskClearAll}
            onCheckedChange={(checked) => setDontAskClearAll(checked as boolean)}
          />
          <label
            htmlFor="dontAskClearAll"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Don't ask next time
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-gray-600 text-white hover:bg-gray-700">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirmClearAll(clearAllType);
              setShowDialog(false);
            }}
            className="bg-red-500 text-white hover:bg-red-600"
          >
            Clear All
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};