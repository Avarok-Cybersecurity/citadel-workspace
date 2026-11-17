import React from 'react';
import type { AgentPlatform } from '@/lib/agent-download';

/**
 * Operating-system marks for the agent download buttons.
 *
 * Every one of those buttons carried the same generic download arrow, so the
 * only thing distinguishing "macOS (Apple Silicon)" from "macOS (Intel)" —
 * or a Windows machine's single button from a Linux one's — was the label text.
 * A recognisable mark is how someone confirms at a glance that the page
 * detected their machine correctly, which is exactly the reassurance wanted at
 * the moment the app has just told them it cannot connect.
 *
 * Inline rather than from an icon package: lucide-react carries no brand marks
 * (they were removed upstream over trademark ambiguity), and a remote sprite is
 * a network request on a screen that is displayed *because* the network failed.
 *
 * Their own module rather than in the agent-setup components, which sat at 136 of the
 * 250 lines `scripts/check-file-length.mjs` allows it; three glyphs would eat
 * most of what is left for reasons unrelated to what that file does.
 *
 * Each is a single path on a 24x24 viewBox, filled with `currentColor` so it
 * inherits the button's foreground in both themes, and `aria-hidden` because
 * the adjacent label already names the platform — a screen reader announcing
 * "Apple macOS (Apple Silicon)" is a stutter, not information.
 */

type IconProps = { className?: string };

const base = (className?: string): React.SVGProps<SVGSVGElement> => ({
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
  focusable: false,
  className,
});

/** The Apple mark, for both macOS builds. */
const AppleIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...base(className)}>
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  </svg>
);

/** The four-pane Windows mark. */
const WindowsIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...base(className)}>
    <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
  </svg>
);

/** Tux, the Linux penguin. */
const LinuxIcon: React.FC<IconProps> = ({ className }) => (
  <svg {...base(className)}>
    <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.596.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139z" />
  </svg>
);

/**
 * The mark for a platform, and the ONLY export.
 *
 * The three glyphs above are module-local deliberately. Exported individually
 * they were three components no JSX site renders --
 * `scripts/check-components-are-mounted.mjs` said so, correctly: they are
 * reached through this record. Keeping the record as the single door means the
 * gate needs no exemption, and a platform can never acquire a mark that nothing
 * maps to.
 *
 * Exhaustive over `AgentPlatform` by construction:
 * a new build target added to that union fails typecheck here rather than
 * silently rendering nothing next to its button.
 */
export const OS_ICONS: Record<AgentPlatform, React.FC<IconProps>> = {
  'macos-arm64': AppleIcon,
  'macos-x64': AppleIcon,
  'linux-x64': LinuxIcon,
  'windows-x64': WindowsIcon,
};
