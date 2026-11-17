/**
 * The steps of installing one app: its listing, where to install it, consent, the server's work,
 * and the answer. Pure; AppFlow.tsx drives it and does the I/O.
 */
import type { AppInstall, Capability, InstallScope } from 'citadel-workspace-client-ts';
import type { AppsFailure } from '@/lib/workspace-service/apps-operations';
import type { ScopeChoice } from './scope-options';

export type FlowState =
  | { step: 'detail' }
  | { step: 'scope'; choice: ScopeChoice | null; people: string[] }
  | { step: 'consent'; scope: InstallScope; turnedOff: Capability[] }
  | { step: 'installing'; scope: InstallScope }
  | { step: 'done'; install: AppInstall }
  | { step: 'failed'; scope: InstallScope; refusal: AppsFailure };

export type FlowEvent =
  | { kind: 'choose-scope' }
  | { kind: 'select'; choice: ScopeChoice | null; people: string[] }
  | { kind: 'consent'; scope: InstallScope }
  | { kind: 'toggle'; cap: Capability; on: boolean }
  | { kind: 'install' }
  | { kind: 'installed'; install: AppInstall }
  | { kind: 'refused'; refusal: AppsFailure }
  | { kind: 'back' };

export const START: FlowState = { step: 'detail' };

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.kind) {
    case 'choose-scope': return state.step === 'detail' ? { step: 'scope', choice: null, people: [] } : state;
    case 'select': return state.step === 'scope' ? { step: 'scope', choice: event.choice, people: event.people } : state;
    case 'consent': return state.step === 'scope' ? { step: 'consent', scope: event.scope, turnedOff: [] } : state;
    case 'toggle': {
      if (state.step !== 'consent') return state;
      const rest: Capability[] = state.turnedOff.filter((c: Capability) => c !== event.cap);
      return { ...state, turnedOff: event.on ? rest : [...rest, event.cap] };
    }
    case 'install': return state.step === 'consent' ? { step: 'installing', scope: state.scope } : state;
    case 'installed': return state.step === 'installing' ? { step: 'done', install: event.install } : state;
    case 'refused': return state.step === 'installing' ? { step: 'failed', scope: state.scope, refusal: event.refusal } : state;
    case 'back':
      if (state.step === 'scope') return START;
      if (state.step === 'consent' || state.step === 'failed') return { step: 'scope', choice: null, people: [] };
      return state;
  }
}
