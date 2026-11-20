/** One fingerprint with its label, set so it can be read aloud group by group. */
export function Fingerprint({ label, value, testId }: { label: string; value: string; testId: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-base tracking-wide text-foreground" data-testid={testId}>{value}</dd>
    </div>
  );
}
