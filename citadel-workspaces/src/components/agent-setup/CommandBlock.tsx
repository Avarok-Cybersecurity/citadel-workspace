import React from 'react';
import { Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { interactive } from '@/lib/a11y';
import { AGENT_SETUP_COPY } from '@/lib/agent-setup-copy';

interface CommandBlockProps {
  command: string;
  /** Accessible name of the scrollable region holding the command. */
  regionLabel: string;
  /** Accessible name of the copy button before it is pressed. */
  copyLabel: string;
}

/**
 * A command on one line, with a copy button.
 *
 * Deliberately not allowed to wrap: inline, the run command broke mid-token -- "--" ending
 * one line and "backend filesystem" starting the next -- which is how someone copies a
 * command that then fails with a usage error they cannot explain.
 *
 * min-w-0 is load-bearing. A flex item defaults to min-width:auto, so a nowrap child cannot
 * shrink below its content width and instead stretches the whole dialog grid: at 375px the
 * header, body and this panel all ran 67px past the dialog's right edge.
 *
 * The <code> is focusable because it scrolls: on a phone the command is longer than the box,
 * and a keyboard user could not otherwise reach the end of the line (axe
 * `scrollable-region-focusable`, serious).
 */
export const CommandBlock: React.FC<CommandBlockProps> = ({ command, regionLabel, copyLabel }) => {
  const { copied, copy } = useCopyToClipboard();
  // The result is not needed here: a refusal is toasted by useCopyToClipboard,
  // and success shows as the control's `copied` tick.
  const handleCopy = (): void => { void copy(command); };

  return (
    <div className="mt-1 flex min-w-0 items-center gap-2">
      <code
        tabIndex={0}
        role="region"
        aria-label={regionLabel}
        className="bg-background min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {command}
      </code>
      <button
        type="button"
        // 24px minimum, the WCAG 2.2 target-size floor: a 16px icon with p-1 measures 21x21.
        className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 inline-flex items-center justify-center min-h-[24px] min-w-[24px]"
        aria-label={copied ? AGENT_SETUP_COPY.advanced.copied : copyLabel}
        {...interactive(handleCopy)}
      >
        {copied
          ? <Check className="h-4 w-4" aria-hidden="true" />
          : <Copy className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
};
