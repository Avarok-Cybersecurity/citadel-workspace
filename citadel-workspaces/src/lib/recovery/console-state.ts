/**
 * The recovery console's guide, as a pure state machine.
 *
 * A session signed in with the recovery phrase (or a code) may only manage how the account signs
 * in, so the console never shows the workspace. It opens on what happened (and, after a recovery
 * on this device, that every other device was signed out), then offers the tasks the server allows
 * a recovery session, then finishes: with a new password the person signs straight in with it;
 * without one they sign out and sign in with whatever they set up.
 */

/** What the recovery console may do: the SDK's `allowed_in_recovery`, as tasks a person picks. */
export type ConsoleTask = 'password' | 'key' | 'credentials' | 'policy' | 'phrase';

export const CONSOLE_TASKS: readonly ConsoleTask[] = ['password', 'key', 'credentials', 'policy', 'phrase'];

export type ConsoleView = 'welcome' | 'tasks' | ConsoleTask | 'finish';

export interface ConsoleState {
  view: ConsoleView;
  /** Tasks the server has carried out in this session. */
  done: readonly ConsoleTask[];
  /** True when this device recovered the account and every other device was signed out. */
  devicesSignedOut: boolean;
}

export type ConsoleAction =
  | { type: 'continue' }
  | { type: 'open'; task: ConsoleTask }
  | { type: 'back' }
  | { type: 'completed'; task: ConsoleTask }
  | { type: 'finish' };

export const openConsole = (devicesSignedOut: boolean): ConsoleState => ({ view: 'welcome', done: [], devicesSignedOut });

export function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case 'continue': return state.view === 'welcome' ? { ...state, view: 'tasks' } : state;
    case 'open': return state.view === 'tasks' ? { ...state, view: action.task } : state;
    case 'back': return state.view === 'welcome' ? state : { ...state, view: 'tasks' };
    case 'completed':
      return {
        ...state,
        view: 'tasks',
        done: state.done.includes(action.task) ? state.done : [...state.done, action.task],
      };
    case 'finish': return state.view === 'tasks' ? { ...state, view: 'finish' } : state;
  }
}

/** How the console ends: straight into the account with the new password, or a sign-out. */
export const endsSignedIn = (state: ConsoleState): boolean => state.done.includes('password');

/** The guide's three stages, for the step indicator. */
export type ConsoleStage = 'What happened' | 'Secure your account' | 'Finish';
export const CONSOLE_STAGES: readonly ConsoleStage[] = ['What happened', 'Secure your account', 'Finish'];

export function stageOf(view: ConsoleView): ConsoleStage {
  if (view === 'welcome') return 'What happened';
  if (view === 'finish') return 'Finish';
  return 'Secure your account';
}
