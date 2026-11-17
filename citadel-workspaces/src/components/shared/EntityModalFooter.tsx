/**
 * The Cancel / submit row every entity modal ends with.
 *
 * The primary submit is the Button's default variant -- a solid `bg-primary` fill -- so an
 * enabled action reads as enabled. It used to be a 20% `primary-accent` tint, the look of the
 * Admin badge and the selected sidebar row, which on a light surface read as disabled.
 */
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';

interface EntityModalFooterProps {
  onCancel: () => void;
  isSubmitting: boolean;
  destructive: boolean;
  label: string;
}

export function EntityModalFooter({ onCancel, isSubmitting, destructive, label }: EntityModalFooterProps): JSX.Element {
  return (
    <DialogFooter>
      {/* Not disabled while submitting: backing out of an in-flight
          request is always a legitimate thing to want, and greying this
          is what made the sealed dialog total. */}
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        className="bg-transparent border-border text-foreground hover:bg-card"
      >
        Cancel
      </Button>
      <Button
        type="submit"
        // Every entity modal submits through here -- create a node, add a
        // member, update a role -- and each spells its own label. One
        // testid means a spec presses "the submit", not "the word Create",
        // which is one rename away from finding nothing.
        data-testid="entity-modal-submit"
        disabled={isSubmitting}
        variant={destructive ? 'destructive' : 'default'}
        className={destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'}
      >
        {label}
      </Button>
    </DialogFooter>
  );
}
