/**
 * Insert › Links and Comments: Link (InsertLink over the selection, or the address inserted as
 * linked text), Remove Link, and New Comment, anchored on the selection or the word at the
 * caret and signed with the signed-in person's name.
 */
import { useState, type ChangeEvent } from 'react';
import { Link, MessageSquarePlus, Unlink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CommentValue } from '@/lib/cdoc/editor/model-values';
import { linkTarget, type LinkTarget } from './link-target';
import { RibbonButton } from './RibbonButton';
import { RibbonDialog, type FieldState } from './RibbonDialog';
import { useRibbon, type Ribbon } from './ribbon-context';

export function LinkControls(): JSX.Element {
  const { run }: Ribbon = useRibbon();
  const [address, setAddress] = useState<string>('');
  const target: LinkTarget = linkTarget(address);
  return (
    <>
      <RibbonDialog testId="ribbon-insert-link" label="Link" icon={Link} text="Link" shortcut={{ key: 'K' }} title="Insert link"
        description="Links the selected text, or inserts the address as a link at the cursor." submitLabel="Insert link"
        invalid={target.ok ? null : target.reason} dirty={address.trim() !== ''} onDiscard={(): void => setAddress('')}
        onSubmit={(): void => { if (target.ok) { setAddress(''); void run({ name: 'insertLink', href: target.href }, 'insert the link'); } }}>
        {(field: FieldState): JSX.Element => (
          <div className="space-y-2">
            <Label htmlFor="ribbon-link-address">Address</Label>
            <Input id="ribbon-link-address" data-testid="ribbon-link-address" type="url" inputMode="url" autoComplete="url" placeholder="https://example.com"
              aria-invalid={field.invalid} aria-describedby={field.describedBy}
              className="min-h-[44px]" value={address} onChange={(e: ChangeEvent<HTMLInputElement>): void => setAddress(e.target.value)} />
          </div>
        )}
      </RibbonDialog>
      <RibbonButton testId="ribbon-remove-link" label="Remove link" icon={Unlink}
        onPress={(): void => { void run({ name: 'removeLink' }, 'remove the link'); }} />
    </>
  );
}

export function CommentControl({ author }: { author: string | null }): JSX.Element {
  const { run, environment }: Ribbon = useRibbon();
  const [text, setText] = useState<string>('');
  return (
    <RibbonDialog testId="ribbon-insert-comment" label="New comment" icon={MessageSquarePlus} text="Comment" title="New comment"
      description={author === null ? 'On the selected text, or the word at the cursor.' : `On the selected text, or the word at the cursor, signed ${author}.`} submitLabel="Comment"
      unavailable={author === null ? 'Your name has not loaded yet, so a comment could not be signed.' : null}
      invalid={text.trim() === '' ? 'Write the comment first.' : null} dirty={text.trim() !== ''} onDiscard={(): void => setText('')}
      onSubmit={(): void => {
        if (author === null) return;
        setText('');
        const comment: CommentValue = {
          id: environment.newCommentId(), author, date: environment.now(), text: text.trim(), resolved: false,
        };
        void run({ name: 'insertComment', comment }, 'add the comment');
      }}>
      {(field: FieldState): JSX.Element => (
        <div className="space-y-2">
          <Label htmlFor="ribbon-comment-text">Comment</Label>
          <Textarea id="ribbon-comment-text" data-testid="ribbon-comment-text" rows={4} value={text}
            aria-invalid={field.invalid} aria-describedby={field.describedBy}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>): void => setText(e.target.value)} />
        </div>
      )}
    </RibbonDialog>
  );
}
