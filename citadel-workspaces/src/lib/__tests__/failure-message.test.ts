import { describe, it, expect } from 'vitest';
import { describeFailure } from '../failure-message';

describe('describeFailure', () => {
  it('prefers what the server actually said', () => {
    expect(
      describeFailure(new Error('Permission denied: EditTreeStructure required'), 'Try again'),
    ).toBe('Permission denied: EditTreeStructure required');
  });

  it('falls back when the error has nothing to say', () => {
    expect(describeFailure(new Error(''), 'Could not save the office.')).toBe(
      'Could not save the office.',
    );
    expect(describeFailure(new Error('   '), 'Could not save the office.')).toBe(
      'Could not save the office.',
    );
  });

  it('accepts a thrown string, which the WASM boundary produces', () => {
    expect(describeFailure('Session already active', 'Try again')).toBe('Session already active');
  });

  it('reads the message of a plain object the WASM client rejects with', () => {
    expect(describeFailure({ message: 'Peer connection not found' }, 'Try again')).toBe('Peer connection not found');
    expect(describeFailure({ message: '  ' }, 'Try again')).toBe('Try again');
  });

  it('falls back for anything else thrown', () => {
    expect(describeFailure({ code: 42 }, 'Could not save.')).toBe('Could not save.');
    expect(describeFailure(undefined, 'Could not save.')).toBe('Could not save.');
    expect(describeFailure(null, 'Could not save.')).toBe('Could not save.');
  });
});
