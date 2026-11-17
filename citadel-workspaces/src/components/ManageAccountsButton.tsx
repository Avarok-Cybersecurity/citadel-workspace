import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';
import { lazyDialog } from './lazy-dialog';
import type { AccountManagementDialog as Dialog } from './AccountManagementDialog';

type DialogProps = React.ComponentProps<typeof Dialog>;

/** Off the landing critical path: most landing visits never open it. */
const AccountManagementDialog: (props: DialogProps) => JSX.Element | null = lazyDialog(
  (): Promise<React.ComponentType<DialogProps>> => import('./AccountManagementDialog').then((m) => m.AccountManagementDialog),
  (props: DialogProps): boolean => props.isOpen,
);

export function ManageAccountsButton(): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);
  /**
   * The button, so closing the dialog can put focus back on it.
   *
   * Measured: closing this dialog with Escape left `document.activeElement` on
   * `<body>`, so a keyboard user was dropped at the top of the document and had
   * to tab back down to where they were. The other two dialogs on this screen
   * restore focus; this one did not, which is the difference a person notices
   * and no automated scan reports -- the markup is identical either way.
   */
  const triggerRef: React.RefObject<HTMLButtonElement> = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        ref={triggerRef}
        data-testid="manage-accounts-button"
        className="gap-2 border-primary-accent text-primary-accent hover:bg-primary-accent/20"
        onClick={() => setDialogOpen(true)}
      >
        <Users className="h-4 w-4" />
        Manage Accounts
      </Button>
      
      <AccountManagementDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onRestoreFocus={() => triggerRef.current?.focus()}
      />
    </>
  );
}