/** The ways out (RecoveryNotice) as a panel draws one inline, and the bug reporter they lead to. */
import { BugReportDialog } from '@/components/bug-report/BugReportDialog';
import { UnreadablePanel } from '@/components/calendar/UnreadablePanel';

const retried = async () => { document.body.setAttribute('data-retried', 'yes'); };

export const RECOVERY_ROUTE_SCENARIOS = {
  'recovery-notice-inline': () => (
    <div style={{ padding: 16 }}>
      <UnreadablePanel what="The hours of Weekly planning with the whole design team’s hosts" reason="it is not available right now (the agent is busy)" retry={retried} />
    </div>
  ),
  'bug-report-dialog': () => <BugReportDialog request={{ surface: 'app.boot-failed' }} onClose={() => undefined} />,
};
