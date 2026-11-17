import { Cpu, ShieldCheck, Tag, Layers, type LucideIcon } from 'lucide-react';
import { verificationLabel } from '@/lib/agent-update/updater-extras';

export interface AgentVersionCardProps {
  /** Null when the agent has not said (it still answered, so it is running). */
  version: string | null;
  os: string;
  /** The update channel, when the agent has one. */
  channel?: string;
  /** The agent's own ML-DSA verdict, when it reports one. Never assumed. */
  mlDsaVerified?: boolean;
}

function Fact({ Icon, term, children }: { Icon: LucideIcon; term: string; children: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{term}
      </dt>
      <dd className="mt-1 break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** Which agent this is: its version, operating system and channel, and what "verified releases" rests on. */
export function AgentVersionCard({ version, os, channel, mlDsaVerified }: AgentVersionCardProps): JSX.Element {
  return (
    <div className="space-y-4" data-testid="agent-version-card">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact Icon={Tag} term="Version">{version ?? 'Unknown'}</Fact>
        <Fact Icon={Cpu} term="Operating system">{os}</Fact>
        {channel !== undefined && <Fact Icon={Layers} term="Update channel">{channel}</Fact>}
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-background p-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success-emphasis/40 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success-emphasis"
          data-testid="agent-verified-badge">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Verified releases
        </span>
        <p className="text-sm text-muted-foreground" data-testid="agent-verification-basis">
          Every update is checked before it installs: {verificationLabel({ mlDsaVerified })}.
        </p>
      </div>
    </div>
  );
}
