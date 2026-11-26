/**
 * No agent takes the member's app notices: the window fires their reminders itself, as it does
 * against an agent that predates app notices. The default for tests about firing, not handing over.
 */
import type { AgentReminders } from '../calendar-background';
import type { ReminderDeps } from '../reminder-runner';

export const NO_AGENT: Pick<ReminderDeps, 'agentTakes' | 'handOver'> = {
  agentTakes: (): boolean => false,
  handOver: (): Promise<void> => Promise.reject(new Error('no agent takes app notices here')),
};

export const NO_AGENT_SIDE: AgentReminders = {
  takes: (): boolean => false,
  onTakesChange: (): (() => void) => (): void => undefined,
  sync: (): Promise<void> => Promise.reject(new Error('no agent takes app notices here')),
  listFired: (): (() => void) => (): void => undefined,
};
