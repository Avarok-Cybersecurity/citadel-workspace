/** The recovery console's guide: every transition, and the ones that must do nothing. Pure: no doubles. */
import { describe, expect, it } from 'vitest';
import { consoleReducer, CONSOLE_TASKS, endsSignedIn, openConsole, stageOf, type ConsoleState } from '../console-state';

const at = (view: ConsoleState['view'], done: ConsoleState['done'] = []): ConsoleState => ({ view, done, devicesSignedOut: false });

describe('the recovery console', () => {
  it('opens on what happened, remembering whether other devices were signed out', () => {
    expect(openConsole(true)).toEqual({ view: 'welcome', done: [], devicesSignedOut: true });
    expect(openConsole(false).devicesSignedOut).toBe(false);
  });

  it('goes welcome -> tasks -> a task -> back to tasks with it done -> finish', () => {
    let s: ConsoleState = consoleReducer(openConsole(false), { type: 'continue' });
    expect(s.view).toBe('tasks');
    s = consoleReducer(s, { type: 'open', task: 'password' });
    expect(s.view).toBe('password');
    s = consoleReducer(s, { type: 'completed', task: 'password' });
    expect(s).toMatchObject({ view: 'tasks', done: ['password'] });
    s = consoleReducer(s, { type: 'finish' });
    expect(s.view).toBe('finish');
  });

  it('records a task once however often it is done', () => {
    const s: ConsoleState = consoleReducer(at('key', ['key']), { type: 'completed', task: 'key' });
    expect(s.done).toEqual(['key']);
  });

  it('goes back to the list from a task or the finish, and nowhere from the welcome', () => {
    for (const task of CONSOLE_TASKS) expect(consoleReducer(at(task), { type: 'back' }).view).toBe('tasks');
    expect(consoleReducer(at('finish'), { type: 'back' }).view).toBe('tasks');
    const welcome: ConsoleState = openConsole(true);
    expect(consoleReducer(welcome, { type: 'back' })).toBe(welcome);
  });

  it('ignores actions that do not belong to the view it is on', () => {
    const welcome: ConsoleState = openConsole(false);
    expect(consoleReducer(welcome, { type: 'open', task: 'key' })).toBe(welcome);
    expect(consoleReducer(welcome, { type: 'finish' })).toBe(welcome);
    const task: ConsoleState = at('policy');
    expect(consoleReducer(task, { type: 'continue' })).toBe(task);
    expect(consoleReducer(task, { type: 'open', task: 'key' })).toBe(task);
    expect(consoleReducer(task, { type: 'finish' })).toBe(task);
  });

  it('ends signed in only when a new password was set', () => {
    expect(endsSignedIn(at('finish', ['key', 'policy']))).toBe(false);
    expect(endsSignedIn(at('finish', ['password']))).toBe(true);
  });

  it('names the stage of every view', () => {
    expect(stageOf('welcome')).toBe('What happened');
    expect(stageOf('finish')).toBe('Finish');
    for (const v of ['tasks', ...CONSOLE_TASKS] as const) expect(stageOf(v)).toBe('Secure your account');
  });
});
