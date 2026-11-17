/**
 * The share dialog as drawn: the Plain/Secure choice, then the plain links or the secure panel.
 * Everything it shows arrives as props, so the polish harness and the tests draw the real thing
 * in each state without a session behind it. ShareLinkDialog wires it to one.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ShareTarget } from '@/lib/share/share-target';
import { LinkField } from './LinkField';
import { ShareModeChoice, type ShareMode } from './ShareModeChoice';

export interface PlainLink {
  target: ShareTarget;
  url: string;
}

interface ShareLinkDialogViewProps {
  open: boolean;
  onClose: () => void;
  targets: readonly ShareTarget[];
  plainLinks: readonly PlainLink[];
  /** Who a plain link opens for, in words: peer storage opens for a pair, server storage for each reader. */
  plainNote: string;
  mode: ShareMode;
  onMode: (mode: ShareMode) => void;
  secureUnavailable: string | null;
  /** The secure panel, drawn when Secure is chosen. */
  secure: JSX.Element | null;
}

export function shareTitle(targets: readonly ShareTarget[]): string {
  return targets.length === 1 ? `Share “${targets[0].label}”` : `Share ${targets.length} items`;
}

export function ShareLinkDialogView(props: ShareLinkDialogViewProps): JSX.Element {
  const { open, onClose, targets, plainLinks, plainNote, mode, onMode, secureUnavailable, secure } = props;
  return (
    <Dialog open={open} onOpenChange={(next: boolean) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-[560px] max-h-[90dvh] overflow-y-auto" data-testid="share-link-dialog">
        <DialogHeader>
          <DialogTitle className="break-words pr-6">{shareTitle(targets)}</DialogTitle>
          <DialogDescription>{mode === 'plain' ? plainNote : 'The link names no folder, file or person. Whoever opens it signs in first, and only the people you choose get through.'}</DialogDescription>
        </DialogHeader>
        <ShareModeChoice value={mode} onChange={onMode} secureUnavailable={secureUnavailable} />
        {mode === 'plain' ? (
          <ul className="flex flex-col gap-[14px]" data-testid="share-plain-links">
            {plainLinks.map((link: PlainLink) => (
              <li key={link.url} className="flex min-w-0 flex-col gap-[6px]">
                {plainLinks.length > 1 && <span className="truncate text-sm font-medium text-foreground">{link.target.label}</span>}
                <LinkField url={link.url} label={`Link to ${link.target.label}`} testId="share-plain-link" />
              </li>
            ))}
          </ul>
        ) : secure}
      </DialogContent>
    </Dialog>
  );
}
