import { CheckCircle2, ChevronRight, KeyRound, LifeBuoy, ListChecks, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CONSOLE_COPY, TASK_COPY } from '@/lib/recovery/copy';
import { CONSOLE_TASKS, type ConsoleTask } from '@/lib/recovery/console-state';

const ICONS: Record<ConsoleTask, typeof Lock> = {
  password: Lock, key: KeyRound, credentials: ListChecks, policy: ShieldCheck, phrase: LifeBuoy,
};

/** The console's tasks, each a full-width 44px row that says whether it is done, then Finish. */
export function ConsoleTaskList({ done, onOpen, onFinish }: {
  done: readonly ConsoleTask[];
  onOpen: (task: ConsoleTask) => void;
  onFinish: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3" data-testid="recovery-console-tasks">
      <div>
        <h3 className="text-base font-semibold">{CONSOLE_COPY.tasksTitle}</h3>
        <p className="text-sm text-muted-foreground">{CONSOLE_COPY.tasksBody}</p>
      </div>
      <ul className="space-y-2">
        {CONSOLE_TASKS.map((task: ConsoleTask) => {
          const Icon: typeof Lock = ICONS[task];
          const finished: boolean = done.includes(task);
          return (
            <li key={task}>
              <button type="button" onClick={(): void => onOpen(task)} data-testid={`recovery-task-${task}`} data-done={finished ? 'true' : undefined}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-left hover:border-primary-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Icon className="h-4 w-4 shrink-0 text-primary-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{TASK_COPY[task].title}</span>
                  <span className="block text-xs text-muted-foreground">{TASK_COPY[task].detail}</span>
                </span>
                {finished
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Done" />
                  : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
      <Button type="button" className="w-full min-h-[44px]" disabled={done.length === 0} onClick={onFinish} data-testid="recovery-console-done">
        {CONSOLE_COPY.done}
      </Button>
    </div>
  );
}
