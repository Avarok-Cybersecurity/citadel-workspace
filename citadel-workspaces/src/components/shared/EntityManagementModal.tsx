import { useState, useEffect, type ReactNode } from "react";
import { EntityField } from './EntityField';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EntityModalFooter } from "./EntityModalFooter";
import { useToast } from "@/hooks/use-toast";
import { debugLog } from '@/lib/debug-config';

export interface FieldConfig {
  id: string;
  label: string;
  type: 'input' | 'textarea' | 'select';
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
  /** Only show this field when mode is in this list. Omit to show in all modes. */
  showInModes?: string[];
}

export interface ModeConfig {
  title: string;
  description: string;
  submitLabel: string;
  submittingLabel: string;
  submitVariant?: 'default' | 'destructive';
}

export interface EntityManagementModalProps<TMode extends string> {
  isOpen: boolean;
  onClose: () => void;
  mode: TMode;
  modes: Record<TMode, ModeConfig>;
  fields: FieldConfig[];
  initialData?: Record<string, string>;
  onSubmit: (formData: Record<string, string>) => Promise<void>;
  customContent?: ReactNode;
  entityName: string;
}

function buildFormState(
  fields: FieldConfig[],
  initialData?: Record<string, string>,
): Record<string, string> {
  const state: Record<string, string> = {};
  for (const field of fields) {
    state[field.id] = initialData?.[field.id] ?? field.defaultValue ?? '';
  }
  return state;
}

export function EntityManagementModal<TMode extends string>({
  isOpen,
  onClose,
  mode,
  modes,
  fields,
  initialData,
  onSubmit,
  customContent,
  entityName,
}: EntityManagementModalProps<TMode>): JSX.Element {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The server's refusal, in the dialog: a toast can land behind it unseen.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>(() =>
    buildFormState(fields, initialData)
  );

  useEffect(() => {
    if (isOpen) {
      setFormData(buildFormState(fields, initialData));
      setSubmitError(null);
    }
    // Only re-sync when isOpen transitions; fields/initialData are stable per caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const modeConfig: ModeConfig = modes[mode];

  // Unguarded on purpose: onOpenChange is Radix's only dismissal channel, so
  // gating it on isSubmitting removed the X, Escape and outside-click at once.
  // Shared component, so that dead end reproduced at every call site.
  const handleClose = (): void => {
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const visibleFields: FieldConfig[] = fields.filter(
      f => !f.showInModes || f.showInModes.includes(mode)
    );
    for (const field of visibleFields) {
      if (field.required && !formData[field.id]?.trim()) {
        toast({
          title: "Validation Error",
          description: `${field.label} is required`,
          variant: "destructive",
        });
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      // The server's own words, not "please try again".
      //
      // `awaitWriteResponse` produces precise rejections -- "Permission denied:
      // EditTreeStructure required", "Cannot demote the only administrator" --
      // and this discarded every one of them into a debugLog, which is a no-op
      // outside dev. A member whose first attempt to create an office is
      // refused was told to retry, and retrying can never work: they cannot
      // distinguish "you do not have permission" from a flaky network, so they
      // try again, and again. The delete path was given this fix; create and
      // edit never were.
      debugLog('EntityManagementModal', `Error managing ${entityName}:`, error);
      const reason: string =
        error instanceof Error && error.message
          ? error.message
          : `The server did not accept the change.`;
      setSubmitError(reason);
      toast({
        title: `Could not ${mode} that ${entityName}`,
        description: reason,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const visibleFields: FieldConfig[] = fields.filter(
    f => !f.showInModes || f.showInModes.includes(mode)
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-foreground">{modeConfig.title}</DialogTitle>
            <DialogDescription className="text-foreground/80">
              {modeConfig.description}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {visibleFields.map(field => (
              <EntityField
                key={field.id}
                field={field}
                value={formData[field.id] ?? ''}
                onChange={(value: string) => setFormData(prev => ({ ...prev, [field.id]: value }))}
                disabled={isSubmitting}
              />
            ))}
            {customContent}
            {submitError && (
              <p role="alert" data-testid="entity-modal-error" className="text-sm text-destructive-emphasis">{submitError}</p>
            )}
          </div>
          <EntityModalFooter
            onCancel={handleClose}
            isSubmitting={isSubmitting}
            destructive={modeConfig.submitVariant === 'destructive'}
            label={isSubmitting ? modeConfig.submittingLabel : modeConfig.submitLabel}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
