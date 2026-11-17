import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldConfig } from './EntityManagementModal';

/**
 * One field of the entity create/edit form.
 *
 * Split out to keep the modal under the file cap after its error handling
 * learned to report the server's actual refusal instead of "please try again".
 * It is a clean seam: the modal owns the form's lifecycle, this owns how a
 * single field looks.
 */
interface EntityFieldProps {
  field: FieldConfig;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

export function EntityField({ field, value, onChange, disabled }: EntityFieldProps): JSX.Element {
  switch (field.type) {
    case 'input':
      return (
        <div className="grid gap-2">
          <Label htmlFor={field.id} className="text-foreground">{field.label}</Label>
          <Input
            id={field.id}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="bg-card text-foreground placeholder:text-muted-foreground"
            required={field.required}
            disabled={disabled}
          />
        </div>
      );
    case 'textarea':
      return (
        <div className="grid gap-2">
          <Label htmlFor={field.id} className="text-foreground">{field.label}</Label>
          <Textarea
            id={field.id}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="bg-card text-foreground placeholder:text-muted-foreground min-h-[100px]"
            disabled={disabled}
          />
        </div>
      );
    case 'select':
      return (
        <div className="grid gap-2">
          <Label htmlFor={field.id} className="text-foreground">{field.label}</Label>
          <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={field.id} className="bg-card text-foreground">
              <SelectValue placeholder={field.placeholder ?? `Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {field.options?.map(option => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="text-foreground hover:bg-card"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
  }
}
