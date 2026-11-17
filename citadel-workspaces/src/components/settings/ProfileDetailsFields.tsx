import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { validateProfileEmail, validateProfileTitle } from '@/lib/profile-rules';

export interface ProfileDetailsValues {
  email: string;
  title: string;
}

interface ProfileDetailsFieldsProps {
  values: ProfileDetailsValues;
  onChange: (field: keyof ProfileDetailsValues, value: string) => void;
  /** Prefixes the input ids, so the wizard and Settings never share one. */
  idPrefix: string;
  disabled?: boolean;
}

const LABEL_CLASS: string = 'text-xs font-semibold tracking-wider uppercase text-muted-foreground';

/**
 * Email and job title, as the sign-up wizard and Settings > General both edit
 * them. One component so the two forms cannot disagree about the rules.
 *
 * Errors show once a field has been left, not while it is being typed.
 */
export function ProfileDetailsFields({ values, onChange, idPrefix, disabled = false }: ProfileDetailsFieldsProps): JSX.Element {
  const [touched, setTouched] = useState<Record<keyof ProfileDetailsValues, boolean>>({ email: false, title: false });
  const errors: Record<keyof ProfileDetailsValues, string | null> = {
    email: touched.email ? validateProfileEmail(values.email.trim()) : null,
    title: touched.title ? validateProfileTitle(values.title.trim()) : null,
  };

  const field = (name: keyof ProfileDetailsValues, label: string, type: string, autoComplete: string, placeholder: string): JSX.Element => {
    const id: string = `${idPrefix}-${name}`;
    const error: string | null = errors[name];
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
        <Input
          id={id}
          name={name}
          type={type}
          value={values[name]}
          onChange={(e) => onChange(name, e.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, [name]: true }))}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`bg-input text-foreground h-11 rounded-lg placeholder:text-muted-foreground focus:ring-1 transition-all ${
            error ? 'border-destructive focus:border-destructive' : 'border-border focus:border-primary-accent focus:ring-ring/30'
          }`}
        />
        {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive-emphasis pl-1">{error}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {field('email', 'Email', 'email', 'email', 'name@example.com')}
      {field('title', 'Job title', 'text', 'organization-title', 'Product designer')}
    </div>
  );
}

/** True when both fields may be sent as they stand. */
export function profileDetailsAreValid(values: ProfileDetailsValues): boolean {
  return validateProfileEmail(values.email.trim()) === null && validateProfileTitle(values.title.trim()) === null;
}
