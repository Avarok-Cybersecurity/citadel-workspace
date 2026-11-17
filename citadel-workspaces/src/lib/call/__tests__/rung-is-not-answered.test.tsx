/**
 * "In call with alice" was said while alice's phone was still ringing.
 *
 * `ParticipantStatus` has five values, and `status !== 'left' && status !==
 * 'declined'` — which counts `invited`, i.e. still being rung — was written out
 * SEVEN times across the stage, the ongoing-call bar, the reducer, the signal
 * handler, the call manager, the group-call entry and the state module, in two
 * different orders.
 *
 * That predicate is right for "do not tear this call down yet" and wrong for
 * any claim about who is ON the call. The bar's own comment says the filters
 * "have to agree" and does not make them agree; `ParticipantTile` read no
 * status at all, so somebody who might never pick up rendered exactly like
 * somebody who had.
 *
 * Two predicates now, in one place, and the difference is visible.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { stillInCall, hasAnswered } from '../participant-presence';
import type { CallParticipant, ParticipantStatus } from '../call-state';
import { ParticipantTile } from '@/components/call/ParticipantTile';

function participant(status: ParticipantStatus): CallParticipant {
  return {
    cid: 7n,
    username: 'alice',
    status,
    speaking: false,
    media: { audio: true, video: false, screen: false },
  } as unknown as CallParticipant;
}

const ALL: readonly ParticipantStatus[] = ['invited', 'connecting', 'active', 'left', 'declined'];

describe('who is still in the call', () => {
  it('keeps everyone who has not hung up or refused', () => {
    expect(ALL.filter((s) => stillInCall(participant(s)))).toEqual(['invited', 'connecting', 'active']);
  });

  it('counts only those who picked up as having answered', () => {
    // The distinction the seven copies could not express. `invited` is the
    // whole point: it is in the first list and not in this one.
    expect(ALL.filter((s) => hasAnswered(participant(s)))).toEqual(['connecting', 'active']);
  });
});

describe('a participant tile', () => {
  it('says so while the phone is still ringing', () => {
    render(<ParticipantTile participant={participant('invited')} stream={null} isSelf={false} />);
    expect(screen.getByTestId('participant-ringing')).toBeTruthy();
  });

  it('does not, once they have answered', () => {
    // The positive control: a tile that always said "ringing" would satisfy the
    // test above and be wrong for the whole call.
    render(<ParticipantTile participant={participant('active')} stream={null} isSelf={false} />);
    expect(screen.queryByTestId('participant-ringing')).toBeNull();
  });

  it('never says it about yourself', () => {
    // Your own tile is not something you are waiting on.
    render(<ParticipantTile participant={participant('invited')} stream={null} isSelf={true} />);
    expect(screen.queryByTestId('participant-ringing')).toBeNull();
  });
});
