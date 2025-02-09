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
import type { FileMetadata } from "@/types/files";

interface DeleteDialogProps {
  showDialog: boolean;
  setShowDialog: (show: boolean) => void;
  fileToDelete: FileMetadata | null;
  dontAskDelete: boolean;
  setDontAskDelete: (value: boolean) => void;
  onConfirmDelete: (file: FileMetadata) => void;
}

export const DeleteDialog = ({
  showDialog,
  setShowDialog,
  fileToDelete,
  dontAskDelete,
  setDontAskDelete,
  onConfirmDelete,
}: DeleteDialogProps) => {
  return (
    <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
      <AlertDialogContent className="bg-[#444A6C] border-[#262C4A] text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-300">
            This action cannot be undone. This will permanently delete the file.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center space-x-2 py-4">
          <Checkbox
            id="dontAskDelete"
            checked={dontAskDelete}
            onCheckedChange={(checked) => setDontAskDelete(checked as boolean)}
          />
          <label
            htmlFor="dontAskDelete"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Don't ask next time
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-gray-600 text-white hover:bg-gray-700">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (fileToDelete) {
                onConfirmDelete(fileToDelete);
              }
              setShowDialog(false);
            }}
            className="bg-red-500 text-white hover:bg-red-600"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};