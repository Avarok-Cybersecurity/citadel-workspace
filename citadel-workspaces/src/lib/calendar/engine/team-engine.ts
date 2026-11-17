/**
 * The core's team-booking, poll and routing-form decisions, typed (design §3.6.2, §3.6.3): the
 * part of the engine that needs no time zones. Reached as `CalendarEngine.team`; a refusal the
 * core throws becomes a `CalendarRefusal` here as everywhere in the engine.
 */
import type { Answer } from '../generated/Answer';
import type { CollectiveOutcome } from '../generated/CollectiveOutcome';
import type { HostAnswer } from '../generated/HostAnswer';
import type { Interval } from '../generated/Interval';
import type { Poll } from '../generated/Poll';
import type { PollVote } from '../generated/PollVote';
import type { ProposalTally } from '../generated/ProposalTally';
import type { RoutingForm } from '../generated/RoutingForm';
import type { RoutingTarget } from '../generated/RoutingTarget';
import { call } from './call';
import type { CalendarGlue } from './load-calendar-wasm';

export interface PollTally {
  /** The proposal most can make, or null before anyone voted. */
  readonly leading: number | null;
  readonly tallies: ProposalTally[];
}

export class TeamEngine {
  constructor(private readonly glue: CalendarGlue) {}

  route(form: RoutingForm, answers: Answer[]): RoutingTarget {
    return call((): unknown => this.glue.route(form, answers));
  }
  checkRoutingForm(form: RoutingForm): void {
    call((): unknown => this.glue.checkRoutingForm(form));
  }
  checkPoll(poll: Poll): void {
    call((): unknown => this.glue.checkPoll(poll));
  }
  checkVote(poll: Poll, vote: PollVote): void {
    call((): unknown => this.glue.checkVote(poll, vote));
  }
  tally(poll: Poll, votes: [string, PollVote][]): PollTally {
    const [leading, tallies] = call<[number | null, ProposalTally[]]>((): unknown => this.glue.tallyPoll(poll, votes));
    return { leading, tallies };
  }
  /** The poll as picked, and the slot it picked. */
  pick(poll: Poll, proposal: number, eventId: string): [Poll, Interval] {
    return call((): unknown => this.glue.pickPoll(poll, proposal, eventId));
  }
  seatsLeft(seats: number, taken: number): number {
    return this.glue.seatsLeft(seats, taken);
  }
  collectiveOutcome(answers: [string, HostAnswer][]): CollectiveOutcome {
    return call((): unknown => this.glue.collectiveOutcome(answers));
  }
  encodeRoutingForm(value: RoutingForm): Uint8Array {
    return call((): unknown => this.glue.encodeRoutingForm(value));
  }
  decodeRoutingForm(bytes: Uint8Array): RoutingForm {
    return call((): unknown => this.glue.decodeRoutingForm(bytes));
  }
  encodePoll(value: Poll): Uint8Array {
    return call((): unknown => this.glue.encodePoll(value));
  }
  decodePoll(bytes: Uint8Array): Poll {
    return call((): unknown => this.glue.decodePoll(bytes));
  }
  encodePollVote(value: PollVote): Uint8Array {
    return call((): unknown => this.glue.encodePollVote(value));
  }
  decodePollVote(bytes: Uint8Array): PollVote {
    return call((): unknown => this.glue.decodePollVote(bytes));
  }
}
