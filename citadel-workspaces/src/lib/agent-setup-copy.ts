import { LINUX_APPIMAGE_ASSET, RELEASE_REPO, type AgentPlatform } from '@/lib/agent-download';

/**
 * Every word the app uses to tell a visitor how to get, install or start the agent.
 *
 * One module, because the instructions drifted whenever they had more than one home: the
 * Mac got an app while the connection dialog and the create-workspace flow kept describing
 * archives, and each copy was right about a different release. `AgentSetup` is the only
 * component that renders these, and `agent-setup-copy-has-one-home.test.ts` fails if any
 * step below is written out in a second source file.
 */
export const AGENT_SETUP_COPY = {
  question: "Don't have the agent running?",
  intro: 'Citadel needs a small program on this machine to hold your connections.',
  /** When the browser, not the agent, is what stands between this page and the agent. */
  loopback: {
    deniedHeading: 'Your browser is blocking Citadel from reaching the agent',
    deniedBody:
      'Chrome asks before a website may connect to apps on this device, and it was told no. To allow it, open the site settings from the icon at the left of the address bar, set local network access (apps on this device) to Allow, and reload.',
    promptHeading: 'Your browser will ask first',
    promptBody:
      'Chrome asks before a website may connect to apps on this device. When it asks, choose Allow: the Citadel agent is the app on this device it connects to.',
  },
  downloadHeading: 'Download the agent',
  noDevice: 'The agent runs on a desktop or laptop; this device cannot host one.',
  mac: {
    button: 'Download Citadel for Mac',
    steps: [
      'Open the downloaded file.',
      'Drag Citadel Agent into Applications.',
      'Open Citadel Agent. It runs in your menu bar and starts when you log in.',
    ],
    note: 'For Apple Silicon and Intel Macs, macOS 13 or later.',
  },
  windows: {
    button: 'Download Citadel for Windows',
    steps: [
      'Open the downloaded file and follow the installer.',
      'Citadel Agent starts now, and again whenever you log in.',
    ],
    note: 'While the installer is unsigned, Windows may show “Windows protected your PC”. Choose More info, then Run anyway.',
  },
  linux: {
    debButton: 'Download for Ubuntu or Debian (.deb)',
    // The package installs a login entry but starts nothing (it has no postinst), so
    // the person has to open it once; "starts when you log in" alone left a fresh
    // install with no agent running until the next login.
    debSteps: [
      'Double-click the downloaded package to install it.',
      'Open Citadel Agent from your applications menu. From then on it starts when you log in.',
    ],
    appImageButton: 'Download AppImage (other distributions)',
    appImageSteps: [
      `Mark it executable: chmod +x ${LINUX_APPIMAGE_ASSET}`,
      `Then run it: ./${LINUX_APPIMAGE_ASSET}`,
      // The static type2 runtime needs only FUSE itself (/dev/fuse, fusermount3), which
      // desktop distributions have; containers and WSL often do not.
      `Where FUSE is unavailable (containers, WSL): ./${LINUX_APPIMAGE_ASSET} --appimage-extract-and-run`,
      `To start it when you log in: ./${LINUX_APPIMAGE_ASSET} --install-autostart`,
    ],
  },
  advanced: {
    toggle: 'Advanced setup',
    archivesHeading: 'Archives for every platform',
    runIntro: 'Once unpacked, run it with:',
    runRegion: 'Command to start the Citadel agent',
    runCopy: 'Copy the run command',
    runNote: 'Both flags matter: there is no default bind address, and the default account store is in-memory.',
    releases: 'All releases and checksums',
    attestation: 'The Linux downloads carry GitHub build attestations. To check a file was built by this project’s release workflow, run:',
    verifyRegion: 'Command to verify a download',
    verifyCopy: 'Copy the verify command',
    copied: 'Command copied',
  },
  archiveLabels: {
    'macos-arm64': 'macOS (Apple Silicon)',
    'macos-x64': 'macOS (Intel)',
    'linux-x64': 'Linux (x64)',
    'windows-x64': 'Windows (x64)',
  } satisfies Record<AgentPlatform, string>,
} as const;

/** The attestation check, for a file the visitor names. */
export const VERIFY_COMMAND: string = `gh attestation verify <file> --repo ${RELEASE_REPO}`;
