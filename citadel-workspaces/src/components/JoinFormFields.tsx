import { User, AtSign, Lock, Eye, EyeOff , type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { CREDENTIAL_LIMITS, validatePassword } from "@/lib/credential-rules";

interface FormFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  icon: LucideIcon;
  hint?: string;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /**
   * Tells the browser and any password manager what this field IS. Without it
   * they fall back to heuristics, which routinely mistake a registration form
   * for a login and cannot tell "confirm password" from "current password" —
   * so the credential is never offered back on the next visit. WCAG 1.3.5 asks
   * for the same thing.
   */
  autoComplete?: string;
  /**
   * Set for the visible text fields only. Deliberately NOT set on the password
   * fields: maxLength truncates silently, so pasting a 24-character password
   * from a manager would register a secret the user never saw and cannot
   * reproduce from their vault. Those fields get an explicit error instead.
   */
  maxLength?: number;
  error?: string | null;
}

function FormField({ id, name, label, value, onChange, placeholder, type, icon: Icon, hint, onBlur, maxLength, error, autoComplete }: FormFieldProps): JSX.Element {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword: boolean = type === 'password';
  const inputType: string | undefined = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          id={id}
          name={name}
          type={inputType}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          autoComplete={autoComplete}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`bg-input text-foreground pl-10 pr-10 h-11 rounded-lg placeholder:text-muted-foreground focus:ring-1 transition-all ${
            error
              ? "border-destructive focus:border-destructive focus:ring-destructive/30"
              : " focus:border-primary-accent focus:ring-ring/30"
          }`}
          placeholder={placeholder}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            // Matches the login form's toggle, which had all of this and was
            // the only one axe ever scanned. This one was icon-only with no
            // accessible name (a critical button-name violation), carried
            // tabIndex={-1} so no keyboard user could reach it at all, and was
            // a 16px target under the WCAG 2.2 24px floor.
            // The name says what the control is; aria-pressed below says whether it
                  // is on. Flipping both made them contradict -- "Hide password,
                  // pressed" announces as hidden while the password is on screen.
                  // The FIELD is in the name; the action is not flipped.
                  //
                  // This form has two password fields, so two buttons both
                  // called "Show password" sat in the tab order with nothing to
                  // tell them apart -- a screen-reader user hears the same name
                  // twice and has to guess which one they are on.
                  //
                  // "Show" stays "Show" whatever the state, for the reason
                  // above: `aria-pressed` carries the state, and flipping the
                  // verb as well made the two contradict -- "Hide password,
                  // pressed" announces as hidden while the password is visible.
                  aria-label={`Show ${label.toLowerCase()}`}
            aria-pressed={showPassword}
            className="tap-target absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {showPassword
              ? <EyeOff className="h-4 w-4" aria-hidden="true" />
              : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive-emphasis pl-1">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground pl-1">{hint}</p>
      )}
    </div>
  );
}

function PasswordStrength({ password }: { password: string }): JSX.Element | null {
  const strength: { level: number; label: string; color: string; } = useMemo((): { level: number; label: string; color: string; } => {
    if (!password) return { level: 0, label: '', color: '' };
    let score: number = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    // A password the validator rejects is never "Strong". Length rewards used
    // to push a 24-character manager password to four green bars and STRONG,
    // while the field beside it turned red with "17 characters or fewer" — the
    // meter and the rule contradicting each other on screen at the same moment.
    // Routing through validatePassword also settles a second disagreement: the
    // meter counted UTF-16 units and the rule counts UTF-8 bytes.
    if (validatePassword(password) !== null) {
      return { level: 1, label: 'Not accepted', color: 'bg-destructive' };
    }

    if (score <= 1) return { level: 1, label: 'Weak', color: 'bg-destructive' };
    if (score === 2) return { level: 2, label: 'Fair', color: 'bg-warning' };
    if (score === 3) return { level: 3, label: 'Good', color: 'bg-warning' };
    return { level: 4, label: 'Strong', color: 'bg-success' };
  }, [password]);

  if (!password) return null;

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex gap-1 flex-1">
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= strength.level ? strength.color : 'bg-border'}`}
          />
        ))}
      </div>
      <span className={`text-xs font-semibold uppercase tracking-wider ${
        strength.level <= 1 ? 'text-destructive-emphasis' :
        strength.level === 2 ? 'text-warning-emphasis' :
        strength.level === 3 ? 'text-warning-emphasis' :
        'text-success-emphasis'
      }`}>
        {strength.label}
      </span>
    </div>
  );
}

interface JoinFormFieldsProps {
  formData: {
    fullName: string;
    username: string;
    password: string;
    confirmPassword: string;
  };
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  fieldErrors?: {
    fullName: string | null;
    username: string | null;
    password: string | null;
    confirmPassword: string | null;
  };
}

export function JoinFormFields({ formData, onChange, onBlur, fieldErrors }: JoinFormFieldsProps): JSX.Element {
  return (
    <div className="space-y-4">
      <FormField
        id="fullName"
        name="fullName"
        label="Full Name"
        icon={User}
        value={formData.fullName}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete="name"
        maxLength={CREDENTIAL_LIMITS.fullName.max}
        error={fieldErrors?.fullName}
        placeholder="John Doe"
      />
      <FormField
        id="username"
        name="username"
        label="Username"
        icon={AtSign}
        value={formData.username}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete="username"
        maxLength={CREDENTIAL_LIMITS.username.max}
        error={fieldErrors?.username}
        placeholder="johndoe"
        hint={formData.username ? `Suggested: @${formData.username.toLowerCase().replace(/\s+/g, '_')}_citadel` : undefined}
      />
      <div>
        <FormField
          id="password"
          name="password"
          label="Profile Password"
          type="password"
          icon={Lock}
          value={formData.password}
          onChange={onChange}
          onBlur={onBlur}
          autoComplete="new-password"
          error={fieldErrors?.password}
          placeholder="••••••••••••"
          // The maximum is SHORTER than what every password manager generates
          // by default, so the users with the best credential hygiene are the
          // ones who get rejected. Stating the range up front is the whole fix;
          // an inline error after the fact still wastes a generated password.
          // Derived from CREDENTIAL_LIMITS so it cannot drift from the rule.
          hint={`${CREDENTIAL_LIMITS.password.min}–${CREDENTIAL_LIMITS.password.max} characters, no spaces`}
        />
        <PasswordStrength password={formData.password} />
      </div>
      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm Profile Password"
        type="password"
        icon={Lock}
        value={formData.confirmPassword}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete="new-password"
        error={fieldErrors?.confirmPassword}
        placeholder="••••••••••••"
      />
    </div>
  );
}
