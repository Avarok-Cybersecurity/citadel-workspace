import React from 'react';
import { Button } from '@/components/ui/button';
import { OS_ICONS } from '@/components/icons/os-icons';
import {
  LINUX_APPIMAGE_ASSET,
  LINUX_DEB_ASSET,
  MAC_APP_ASSET,
  WINDOWS_INSTALLER_ASSET,
  releaseAssetUrl,
  type AgentPlatform,
  type InstallerFamily,
} from '@/lib/agent-download';
import { AGENT_SETUP_COPY } from '@/lib/agent-setup-copy';

interface DownloadButtonProps {
  asset: string;
  label: string;
  testId: string;
  /** Which platform's mark to draw: the icon is how a visitor confirms the page read their OS. */
  mark: AgentPlatform;
  variant: 'default' | 'secondary';
}

export const DownloadButton: React.FC<DownloadButtonProps> = ({ asset, label, testId, mark, variant }) => {
  const OsIcon: React.FC<{ className?: string }> = OS_ICONS[mark];
  return (
    // Allowed to wrap: at 375px the longest label would otherwise run past the dialog's edge.
    <Button size="sm" variant={variant} className="h-auto min-h-9 whitespace-normal py-1.5 text-left" asChild>
      <a href={releaseAssetUrl(asset)} download={asset} data-testid={testId}>
        <OsIcon className="mr-2 h-4 w-4" />
        {label}
      </a>
    </Button>
  );
};

const Steps: React.FC<{ steps: readonly string[] }> = ({ steps }) => (
  <ol className="text-muted-foreground mt-2 list-decimal space-y-1 pl-5">
    {steps.map((step) => <li key={step}>{step}</li>)}
  </ol>
);

const Mac: React.FC = () => (
  <>
    <div className="mt-3">
      <DownloadButton asset={MAC_APP_ASSET} label={AGENT_SETUP_COPY.mac.button} testId="agent-download-macos-app" mark="macos-arm64" variant="default" />
    </div>
    <Steps steps={AGENT_SETUP_COPY.mac.steps} />
    <p className="text-muted-foreground mt-2">{AGENT_SETUP_COPY.mac.note}</p>
  </>
);

const Windows: React.FC = () => (
  <>
    <div className="mt-3">
      <DownloadButton asset={WINDOWS_INSTALLER_ASSET} label={AGENT_SETUP_COPY.windows.button} testId="agent-download-windows-installer" mark="windows-x64" variant="default" />
    </div>
    <Steps steps={AGENT_SETUP_COPY.windows.steps} />
    <p className="text-muted-foreground mt-2">{AGENT_SETUP_COPY.windows.note}</p>
  </>
);

/** Two installers, the package first: Ubuntu and Debian are most Linux desktops. */
const Linux: React.FC = () => (
  <>
    <div className="mt-3">
      <DownloadButton asset={LINUX_DEB_ASSET} label={AGENT_SETUP_COPY.linux.debButton} testId="agent-download-linux-deb" mark="linux-x64" variant="default" />
    </div>
    <Steps steps={AGENT_SETUP_COPY.linux.debSteps} />
    <div className="mt-3">
      <DownloadButton asset={LINUX_APPIMAGE_ASSET} label={AGENT_SETUP_COPY.linux.appImageButton} testId="agent-download-linux-appimage" mark="linux-x64" variant="secondary" />
    </div>
    <Steps steps={AGENT_SETUP_COPY.linux.appImageSteps} />
  </>
);

const FAMILY: Record<InstallerFamily, React.FC> = { mac: Mac, windows: Windows, linux: Linux };

/**
 * The visitor's own one-click installer, or -- on a phone or an unrecognised device -- a plain
 * statement that none fits. Offering a desktop download there would complete and never run,
 * which looks like a broken release.
 */
export const OneClickInstall: React.FC<{ family: InstallerFamily | undefined }> = ({ family }) => {
  if (family === undefined) {
    return <p className="text-muted-foreground mt-2">{AGENT_SETUP_COPY.noDevice}</p>;
  }
  const Section: React.FC = FAMILY[family];
  return <Section />;
};
