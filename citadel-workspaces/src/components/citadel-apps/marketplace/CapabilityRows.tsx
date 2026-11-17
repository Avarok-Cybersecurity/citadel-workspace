/**
 * The consent screen's permission list: every capability on its own row, never truncated, with
 * the publisher's reason, its risk in words and colour, each network host listed separately, and a
 * switch only for what the manifest marks optional.
 */
import { Switch } from '@/components/ui/switch';
import type { Capability } from 'citadel-workspace-client-ts';
import type { ConsentRow } from '@/lib/citadel-apps/consent-model';
import { RISK_LABEL, type Risk } from '@/lib/citadel-apps/capability-copy';

const RISK_CLASS: Record<Risk, string> = {
  low: 'text-muted-foreground',
  medium: 'text-warning-emphasis',
  high: 'text-destructive-emphasis',
  critical: 'text-destructive-emphasis font-semibold',
};

interface CapabilityRowsProps {
  rows: readonly ConsentRow[];
  onToggle: (cap: Capability, on: boolean) => void;
}

export function CapabilityRows({ rows, onToggle }: CapabilityRowsProps): JSX.Element {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="apps-consent-rows">
      {rows.map((row: ConsentRow) => (
        <li key={row.cap} className="flex items-start gap-[12px] p-[12px]" data-testid="apps-consent-row" data-cap={row.cap} data-risk={row.risk}>
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <span className="break-words font-medium text-foreground">{row.label}</span>
            <span className="break-words text-sm text-foreground/80">“{row.why}”</span>
            {row.hosts.length > 0 && (
              <ul className="flex flex-col gap-[2px] pl-[4px]" aria-label="Websites">
                {row.hosts.map((host: string) => (
                  <li key={host} className="break-all font-mono text-sm text-foreground" data-testid="apps-consent-host">{host}</li>
                ))}
              </ul>
            )}
            {row.memberNote !== null && <span className="break-words text-xs text-muted-foreground" data-testid="apps-consent-member-note">{row.memberNote}</span>}
            <span className={`text-xs ${RISK_CLASS[row.risk]}`}>{RISK_LABEL[row.risk]}{row.optional ? '' : ' · Required'}</span>
            {row.blocked !== null && <span className="break-words text-xs text-destructive-emphasis" data-testid="apps-consent-blocked">{row.blocked}</span>}
          </div>
          {row.optional && (
            // The label is the 44px target; the switch inside it is drawn smaller.
            <label htmlFor={`apps-consent-toggle-${row.cap}`} className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
              <Switch
                id={`apps-consent-toggle-${row.cap}`}
                checked={row.on}
                disabled={row.blocked !== null}
                onCheckedChange={(on: boolean) => onToggle(row.cap, on)}
                aria-label={`Allow: ${row.label}`}
                data-testid="apps-consent-toggle"
              />
            </label>
          )}
        </li>
      ))}
    </ul>
  );
}
