import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
}

/**
 * Progress through a multi-step form.
 *
 * State was carried entirely by colour and a tick glyph: a screen reader read
 * "1 Server 2 Security 3 Profile" and said nothing about which step the user was
 * on or which were done. That is WCAG 1.4.1 — colour as the only means of
 * conveying information — and it is also just unhelpful, since the position in a
 * three-step registration is the one thing a person wants to know.
 *
 * The visuals are unchanged. What is added is a name for the whole control that
 * states the position, `aria-current="step"` on the active one, and a
 * screen-reader-only word for each step's state.
 */
export function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps): JSX.Element {
  return (
    <div
      className="flex items-center justify-center gap-0 mt-1"
      role="list"
      aria-label={`Step ${currentStep} of ${totalSteps}`}
    >
      {Array.from({ length: totalSteps }, (_, i) => {
        const step: number = i + 1;
        const isCompleted: boolean = step < currentStep;
        const isActive: boolean = step === currentStep;
        return (
          <div
            key={step}
            className="flex items-center"
            role="listitem"
            aria-current={isActive ? 'step' : undefined}
          >
            {/* Step circle + label */}
            <div className="flex flex-col items-center gap-1.5 min-w-[60px]">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300",
                  isCompleted && "bg-success text-success-foreground",
                  isActive && "bg-primary text-primary-foreground ring-4 ring-ring/20",
                  !isCompleted && !isActive && "bg-card text-muted-foreground border border-surface"
                )}
              >
                {isCompleted ? <Check className="w-4 h-4" strokeWidth={3} aria-hidden="true" /> : step}
              </div>
              {/* The state in words. `sr-only` so nothing changes visually --
                  the colours already say it to anyone who can see them. */}
              <span className="sr-only">
                {isCompleted ? 'Completed: ' : isActive ? 'Current step: ' : 'Not started: '}
              </span>
              {labels && labels[i] && (
                <span
                  className={cn(
                    "text-xs font-semibold tracking-wider uppercase",
                    isActive && "text-primary-accent",
                    isCompleted && "text-success-emphasis",
                    !isCompleted && !isActive && "text-muted-foreground"
                  )}
                >
                  {labels[i]}
                </span>
              )}
            </div>
            {/* Connector line */}
            {step < totalSteps && (
              <div
                aria-hidden="true"
                className={cn(
                  "w-12 h-[2px] mx-1 rounded-full transition-colors duration-300",
                  step < currentStep ? "bg-success" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
