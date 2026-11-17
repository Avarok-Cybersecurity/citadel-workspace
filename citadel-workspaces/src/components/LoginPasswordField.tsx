import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Lock } from "lucide-react";

/** The sign-in form's password field and its show/hide toggle. Moved verbatim from Login.tsx. */
export function LoginPasswordField({ value, onChange, invalid, describedBy }: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedBy: string | undefined;
}): JSX.Element {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor="password" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
        Password
      </label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          id="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          placeholder="••••••••••••"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-input border-border text-foreground pl-10 pr-10 h-11 rounded-lg placeholder:text-muted-foreground focus:border-primary-accent focus:ring-1 focus:ring-ring/30 transition-all"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          // The name says what the control is; aria-pressed below says whether it
        // is on. Flipping both made them contradict -- "Hide password,
        // pressed" announces as hidden while the password is on screen.
        aria-label="Show password"
          aria-pressed={showPassword}
          // The icon stays 16px; the BUTTON is 24px, the WCAG 2.2
          // target-size floor. Centring the icon inside keeps the
          // position identical while the thumb gets something to aim
          // at. `right-3` becomes right-2 to keep the visual inset
          // once the box grew.
          className="tap-target absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
        >
          {showPassword
            ? <EyeOff className="h-4 w-4" aria-hidden="true" />
            : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
