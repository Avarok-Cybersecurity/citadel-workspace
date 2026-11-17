import React, { useId, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AGENT_ASSETS, RELEASES_PAGE, type AgentPlatform } from '@/lib/agent-download';
import { AGENT_SETUP_COPY, VERIFY_COMMAND } from '@/lib/agent-setup-copy';
import { CommandBlock } from './CommandBlock';
import { DownloadButton } from './OneClickInstall';

const PLATFORMS: AgentPlatform[] = Object.keys(AGENT_ASSETS) as AgentPlatform[];

/**
 * The same Advanced section everywhere: every raw archive, the exact run command, the
 * releases page with its checksums, and how to verify a Linux download's build attestation.
 *
 * Collapsed by default. The one-click installer above it is the answer for almost everyone;
 * this is for someone who wants the bare binary, runs it under their own supervisor, or
 * checks what they downloaded before running it.
 */
export const AgentSetupAdvanced: React.FC<{ runCommand: string }> = ({ runCommand }) => {
  const [open, setOpen] = useState(false);
  const panelId: string = useId();
  const copy: typeof AGENT_SETUP_COPY.advanced = AGENT_SETUP_COPY.advanced;

  return (
    <div className="mt-3 min-w-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 min-h-[24px] gap-1 px-2"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="agent-setup-advanced-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        {copy.toggle}
      </Button>

      {open && (
        <div id={panelId} className="mt-2 min-w-0" data-testid="agent-setup-advanced">
          <p className="text-foreground font-medium">{copy.archivesHeading}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORMS.map((platform) => (
              <DownloadButton
                key={platform}
                asset={AGENT_ASSETS[platform]}
                label={AGENT_SETUP_COPY.archiveLabels[platform]}
                testId={`agent-download-${platform}`}
                mark={platform}
                variant="secondary"
              />
            ))}
          </div>

          <p className="text-muted-foreground mt-3">{copy.runIntro}</p>
          <CommandBlock command={runCommand} regionLabel={copy.runRegion} copyLabel={copy.runCopy} />
          <p className="text-muted-foreground mt-2">{copy.runNote}</p>

          <p className="text-muted-foreground mt-3">{copy.attestation}</p>
          <CommandBlock command={VERIFY_COMMAND} regionLabel={copy.verifyRegion} copyLabel={copy.verifyCopy} />

          <a
            href={RELEASES_PAGE}
            target="_blank"
            rel="noreferrer"
            // py-1 for the 24px target floor: the text alone is 18px tall.
            className="text-foreground mt-2 inline-flex items-center gap-1 py-1 min-h-[24px] underline underline-offset-4 hover:text-muted-foreground"
          >
            {copy.releases}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
};
