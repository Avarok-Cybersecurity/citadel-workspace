/**
 * One member's permissions, opened from their row in the sidebar.
 *
 * It used to open the workspace-wide role matrix: four role columns for a
 * question about one person, with no sign of who they were, where the edit
 * applied, or why a box was already ticked. This view is about THAT person at
 * THAT level: who they are and their role, the path from the workspace down to
 * the level, what they can do there and which level each grant comes from, and
 * the edits Save would send — for them, there, and nothing else.
 *
 * The server stays the authority: every tick is its answer, and Save sends the
 * difference from it (see use-member-permission-editor).
 */
import { useRef, useState, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { useToast } from '@/hooks/use-toast';
import { toastError, toastSuccess } from '@/lib/toast-helpers';
import { describeFailure } from '@/lib/failure-message';
import { MemberRoleBadge } from '@/components/shared/MemberRoleBadge';
import type { RoleHolder } from '@/components/shared/RoleIcon';
import type { User as WorkspaceMember } from '@/types/workspace-entities';
import { changeCount } from './permission-changes';
import { levelPhrase } from './member-permission-path';
import { useMemberPermissionEditor, type MemberPermissionEditor } from './use-member-permission-editor';
import { MemberPermissionList, MemberPermissionPathBar } from './MemberPermissionList';

/** Who the editor is about: just what it shows. Each list that opens it has its own member shape. */
export type PermissionSubject = Pick<WorkspaceMember, 'id' | 'username' | 'displayName'> & RoleHolder;

interface MemberPermissionsDialogProps {
  open: boolean;
  onClose: () => void;
  member: PermissionSubject;
  /** The level the editor was opened at: a node id, or the workspace root. */
  domainId: string;
}

function Status({ editor, name }: { editor: MemberPermissionEditor; name: string }): JSX.Element | null {
  if (editor.failure !== null) {
    return <p role="alert" className="px-6 py-3 text-sm text-destructive-emphasis">{editor.failure} Nothing can be saved until every level has answered.</p>;
  }
  if (editor.ready) return null;
  return (
    <p role="status" className="flex items-center gap-2 px-6 py-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading {name}’s permissions…
    </p>
  );
}

export function MemberPermissionsDialog({ open, onClose, member, domainId }: MemberPermissionsDialogProps): JSX.Element {
  const editor: MemberPermissionEditor = useMemberPermissionEditor(member.id, domainId);
  const { toast } = useToast();
  const [saving, setSaving] = useState<boolean>(false);
  const content: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const name: string = member.displayName || member.username;
  // The role the server reports at this level, once it has; the roster's until then.
  const role: RoleHolder = editor.targetLoad.status === 'loaded'
    ? { roleId: editor.targetLoad.roleId ?? undefined, role: editor.targetLoad.role }
    : member;
  const where: string = levelPhrase(editor.target);
  const count: number = changeCount(editor.changes);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await editor.save();
      toastSuccess(toast, 'Permissions updated', `Saved ${name}’s permissions in ${where}.`);
      onClose();
    } catch (error) {
      toastError(toast, 'Error', describeFailure(error, 'Failed to update permissions. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => { if (!next) onClose(); }}>
      {/* Focus lands on the dialog itself, so a reader announces who and where (title and description)
          before anything else, and Tab goes on to the first permission. Left to Radix it landed on
          Cancel: the list renders only once every level has answered, so Cancel was the first stop. */}
      <DialogContent
        className="flex max-w-xl flex-col gap-0 overflow-hidden p-0"
        data-testid="member-permissions-dialog"
        ref={content}
        onOpenAutoFocus={(event: Event) => { event.preventDefault(); content.current?.focus(); }}
      >
        <DialogHeader className="space-y-3 border-b border-border px-6 pb-4 pt-6 text-left">
          <div className="flex items-center gap-3 pr-8">
            <MemberAvatar username={member.username} name={name} className="h-10 w-10 text-sm" />
            <div className="min-w-0">
              <DialogTitle className="truncate leading-tight">{name}’s permissions</DialogTitle>
              <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">@{member.username}</span>
                <MemberRoleBadge holder={role} data-testid="member-permissions-role" />
              </p>
            </div>
          </div>
          <MemberPermissionPathBar path={editor.path} />
          <DialogDescription className="text-xs">
            Changes apply to {name} in {where}, and reach what sits inside it. Grants from a level above are changed there.
          </DialogDescription>
        </DialogHeader>

        <Status editor={editor} name={name} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {editor.ready && <MemberPermissionList editor={editor} />}
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="member-permissions-summary">
            {count === 0 ? 'No changes yet.' : `${count} ${count === 1 ? 'change' : 'changes'} for ${name} in ${where}.`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving || !editor.ready || count === 0} data-testid="member-permissions-save">
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Saving…</> : 'Save changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
