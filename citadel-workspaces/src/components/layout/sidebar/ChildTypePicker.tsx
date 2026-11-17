import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getEntityMetadata } from '@/lib/entity-type-registry';

interface ChildTypePickerProps {
  parentName: string;
  types: readonly string[];
  onPick: (type: string) => void;
  onClose: () => void;
}

/** Shown when the schema allows more than one kind of child under a parent. */
export function ChildTypePicker({ parentName, types, onPick, onClose }: ChildTypePickerProps): JSX.Element {
  return (
    <Dialog open onOpenChange={(open: boolean): void => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="child-type-picker">
        <DialogHeader>
          <DialogTitle>Add to {parentName}</DialogTitle>
          <DialogDescription>Choose what to add.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {types.map((type: string): JSX.Element => {
            const { icon: Icon, label } = getEntityMetadata(type);
            return (
              <Button key={type} variant="outline" className="justify-start gap-2" data-testid={`child-type-${type}`} onClick={(): void => onPick(type)}>
                <Icon className="h-4 w-4" />
                {label}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
