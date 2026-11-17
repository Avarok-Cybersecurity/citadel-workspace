/**
 * The step-progress row inside LoadingModal.
 *
 * Extracted so the modal stays under the file cap after it gained dialog
 * semantics. The accessibility work here is the reason it is worth keeping
 * together: progress used to be distinguishable ONLY by fill colour, which a
 * colour-blind user cannot read and a screen reader cannot see at all, so the
 * ring and `aria-current` carry it independently of hue.
 */
interface LoadingModalStepsProps {
  steps: Array<{ key: string; shortLabel: string }>;
  currentStepIndex: number;
}

export function LoadingModalSteps({ steps, currentStepIndex }: LoadingModalStepsProps): JSX.Element {
  return (
    <div className="mt-6">
      <div className="flex justify-center gap-2">
        {steps.map((step, index) => (
          <div
            key={step.key}
            aria-current={index === currentStepIndex ? 'step' : undefined}
            className={`w-2 h-2 rounded-full transition-colors duration-300 ${index === currentStepIndex
              ? "bg-primary-accent ring-2 ring-primary-accent/50 ring-offset-1 ring-offset-background"
              : "bg-primary-accent/30"
              }`}
          />
        ))}
        <div className="w-2 h-2 rounded-full bg-primary-accent/30" />
      </div>
      <div className="flex justify-center gap-4 mt-2 text-xs text-muted-foreground">
        {steps.map((step, index) => (
          <span
            key={step.key}
            className={index === currentStepIndex ? "text-primary-accent font-semibold" : ""}
          >
            {step.shortLabel}
            {index === currentStepIndex && <span className="sr-only"> (current step)</span>}
          </span>
        ))}
        <span>Ready</span>
      </div>
    </div>
  );
}
