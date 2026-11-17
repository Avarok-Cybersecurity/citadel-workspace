/**
 * A messaging trust choice: the options as a radio group, and under the node option the node
 * picker. Shared by the workspace's section and the member's own row so the two read alike.
 *
 * Each option is a whole-row label; the radio itself is a 24px target around its 16px ring.
 */
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TRUST_SECTION_COPY, type ChoiceCopy } from '@/lib/messaging-trust/copy';
import type { TrustNodeOption } from '@/lib/messaging-trust/trust-choice';

interface TrustChoiceGroupProps<C extends string> {
  id: string;
  label: string;
  value: C;
  choices: readonly C[];
  copy: Record<C, ChoiceCopy>;
  /** The choice the node picker belongs to. */
  nodeChoice: C;
  nodeOptions: readonly TrustNodeOption[];
  nodeId: string | null;
  /** Choices that cannot be taken now, e.g. a node when there is none to pick. */
  unavailable: ReadonlySet<C>;
  disabled: boolean;
  onChange: (choice: C) => void;
  onNodeChange: (nodeId: string) => void;
}

export function TrustChoiceGroup<C extends string>(props: TrustChoiceGroupProps<C>): JSX.Element {
  const { id, label, value, choices, copy, nodeChoice, nodeOptions, nodeId, unavailable, disabled, onChange, onNodeChange } = props;
  return (
    <RadioGroup
      value={value}
      onValueChange={(next: string): void => { const picked: C | undefined = choices.find((c: C): boolean => c === next); if (picked) onChange(picked); }}
      disabled={disabled}
      aria-label={label}
      className="space-y-1"
      data-testid={`trust-choices-${id}`}
    >
      {choices.map((choice: C) => (
        <div key={choice} className="rounded-md">
          <div className="flex min-h-11 items-start gap-3 rounded-md p-2 hover:bg-surface/60">
            <RadioGroupItem value={choice} id={`${id}-${choice}`} className="-mt-0.5" disabled={unavailable.has(choice)} data-testid={`trust-choice-${id}-${choice}`} />
            <Label htmlFor={`${id}-${choice}`} className="flex-1 cursor-pointer text-sm font-normal leading-snug">
              <span className="font-medium">{copy[choice].label}</span>
              <span className="block text-xs text-muted-foreground">{copy[choice].detail}</span>
            </Label>
          </div>
          {choice === nodeChoice && value === nodeChoice && (
            <div className="pb-2 pl-9 pr-2">
              {nodeOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">{TRUST_SECTION_COPY.noNodes}</p>
              ) : (
                <Select value={nodeId ?? undefined} onValueChange={onNodeChange} disabled={disabled}>
                  <SelectTrigger aria-label={TRUST_SECTION_COPY.nodePickerLabel} data-testid={`trust-node-picker-${id}`}>
                    <SelectValue placeholder={TRUST_SECTION_COPY.nodePickerPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {nodeOptions.map((option: TrustNodeOption) => (
                      <SelectItem key={option.id} value={option.id} data-testid={`trust-node-option-${id}-${option.id}`}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>
      ))}
    </RadioGroup>
  );
}
