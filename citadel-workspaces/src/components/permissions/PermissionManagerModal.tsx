import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PermissionManager } from './PermissionManager';

interface PermissionManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** The read-only "Role permissions" reference, in a dialog. See PermissionManager. */
export const PermissionManagerModal: React.FC<PermissionManagerModalProps> = ({ isOpen, onClose }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/* `sr-only` on the default Radix close button keeps the dialog's
          built-in dismiss control in the keyboard tab order and the
          a11y tree while leaving the borderless overlay design intact; the
          visible way out is the reference's own Close button. */}
      {/* Width tuned to fit the 5-column matrix (200px label column + 4 role
          columns at min-w-[90px] each, plus padding), with slack for a longer
          label; below that the table scrolls inside its own container. */}
      {/* Named. Radix warns about a missing title and the reader announces just
          "dialog"; the heading it needs is the h2 inside PermissionManager. */}
      <DialogContent
        aria-label="Role permissions"
        className="max-w-3xl p-0 bg-transparent border-0 shadow-none [&>button]:sr-only"
      >
        <PermissionManager onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
};
