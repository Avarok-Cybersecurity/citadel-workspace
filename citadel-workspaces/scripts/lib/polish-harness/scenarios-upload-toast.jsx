/** The upload toast while a push waits behind an earlier transfer of its session (lib/revfs/push-watch.ts). */
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { pushPhaseLabel } from '@/lib/revfs/push-watch';

/** Long enough to wrap at a phone's width; one unbroken word, as file names often are. */
export const WAITING_FILE_NAME = 'quarterly-board-minutes-final-revision-2026-11-25_signed.pdf';

function WaitingUpload() {
  useEffect(() => {
    const id = toast.loading(pushPhaseLabel(WAITING_FILE_NAME, { kind: 'waiting-for-earlier' }), { duration: Infinity });
    return () => { toast.dismiss(id); };
  }, []);
  return <Toaster />;
}

export const UPLOAD_TOAST_SCENARIOS = {
  'upload-waiting-toast': WaitingUpload,
};
