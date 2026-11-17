import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format-time';
import type { SignInCredential } from '@/lib/sign-in/types';

/** One security key: its name (renamable in place), when it was added and last used, and Remove. */
export function CredentialRow({ credential, busy, onRename, onRemove }: {
  credential: SignInCredential;
  busy: boolean;
  onRename: (label: string) => Promise<boolean>;
  onRemove: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [label, setLabel] = useState<string>(credential.label);
  const field: React.RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  // Into the field the Rename button just revealed.
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  const used: string = credential.last_used_ms === null
    ? 'Not used yet' : `Last used ${formatDateTime(Number(credential.last_used_ms))}`;

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (await onRename(label.trim())) setEditing(false);
  };

  return (
    <li className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background/50" data-testid="sign-in-key">
      {editing ? (
        <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { void save(e); }}>
          <Input aria-label={`New name for ${credential.label}`} ref={field} value={label} maxLength={64} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" variant="ghost" size="sm" disabled={busy || !label.trim()} aria-label="Save name" data-testid="sign-in-key-save-name">
            <Check className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-label="Cancel renaming" onClick={() => { setLabel(credential.label); setEditing(false); }}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{credential.label}</p>
            <p className="text-xs text-muted-foreground">Added {formatDateTime(Number(credential.created_ms))} · {used}</p>
          </div>
          <div className="flex shrink-0">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)} aria-label={`Rename ${credential.label}`} data-testid="sign-in-key-rename">
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemove} aria-label={`Remove ${credential.label}`} data-testid="sign-in-key-remove">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
