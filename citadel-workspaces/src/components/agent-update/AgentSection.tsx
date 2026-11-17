import { useId, type ReactNode } from 'react';

/** One titled block of the agent page: a heading the section is named by, a sentence, and its content. */
export function AgentSection({ title, description, children }: { title: string; description?: string; children: ReactNode }): JSX.Element {
  const id: string = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
      <div className="space-y-1">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        {description !== undefined && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
