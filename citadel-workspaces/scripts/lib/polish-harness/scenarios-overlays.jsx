/** The labelled-field views whose help used to lie on the control it explains. */
import { TooltipProvider } from '@/components/ui/tooltip';
import { SecurityModeSelect } from '@/components/security/SecurityModeSelect';
import { SecurityLevelSelect } from '@/components/security/SecurityLevelSelect';

function SecurityHints() {
  return (
    <TooltipProvider>
      <div style={{ width: 320, padding: 16, display: 'grid', gap: 16 }}>
        <SecurityModeSelect />
        <SecurityLevelSelect />
      </div>
    </TooltipProvider>
  );
}

export const OVERLAY_SCENARIOS = { 'security-hints': SecurityHints };
