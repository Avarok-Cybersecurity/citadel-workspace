/**
 * The Calendar's consent prompt (design §3.8): an app in this member's session wants to change
 * their calendar. Allow and Refuse are remembered, and can be changed under "Apps"; Allow once
 * lets this one change through and asks again next time.
 */
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { SdkConsent } from './use-sdk-consent';

export function SdkConsentPrompt({ consent }: { consent: SdkConsent }): JSX.Element {
  const { asking, answer } = consent;
  return (
    <AlertDialog open={asking !== null}>
      <AlertDialogContent data-testid="calendar-sdk-consent">
        <AlertDialogHeader>
          <AlertDialogTitle>Let {asking} change your calendar?</AlertDialogTitle>
          <AlertDialogDescription>
            It wants to add events to your calendar, and to change or remove the events it adds. It cannot change events you or other apps made.
            You can change your answer later under Apps.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="h-[44px]" onClick={(): void => answer('refuse')}>Refuse</Button>
          <Button variant="outline" className="h-[44px]" onClick={(): void => answer('once')}>Allow once</Button>
          <Button className="h-[44px]" onClick={(): void => answer('allow')}>Allow</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
