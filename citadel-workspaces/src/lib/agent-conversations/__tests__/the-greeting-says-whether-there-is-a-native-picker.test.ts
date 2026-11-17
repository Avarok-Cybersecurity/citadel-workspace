/**
 * The agent's greeting may carry `native_picker`: whether it can open a file dialog on this
 * machine. An agent without a desktop session (a headless Linux box) says false. An older
 * agent says nothing, and nothing is not false: it is offered the picker as it always was.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { agentNativePicker, forgetCapabilities } from '../capabilities';
import { agentFacts } from '@/lib/agent-update/agent-facts';
import { greetAs } from './agent-greeting';

afterEach(() => { forgetCapabilities(); });

describe('native_picker in the greeting', () => {
  it('false is read as false', async () => {
    await greetAs(true, { native_picker: false });
    expect(await agentNativePicker()).toBe(false);
  });

  it('true is read as true', async () => {
    await greetAs(true, { native_picker: true });
    expect(await agentNativePicker()).toBe(true);
  });

  it('absent from an older agent is unknown, not false', async () => {
    await greetAs('older');
    expect(await agentNativePicker()).toBeUndefined();
  });

  it('a value that is not a boolean is unknown, not false', async () => {
    await greetAs(true, { native_picker: 'no' });
    expect(await agentNativePicker()).toBeUndefined();
  });
});

describe('the rest of what a greeting may say', () => {
  it('keeps the agent\'s version and operating system for the About tab, and forgets them with the socket', async () => {
    await greetAs(true, { agent_version: '0.9.1', os: 'linux' });
    expect(agentFacts.get()).toEqual({ version: '0.9.1', os: 'linux' });
    forgetCapabilities();
    expect(agentFacts.get()).toEqual({});
  });
});
