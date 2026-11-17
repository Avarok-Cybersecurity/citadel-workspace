import { describe, expect, it } from 'vitest';
import { checkAnswers } from '../booking-form';
import type { Question } from '../generated/Question';
import type { FormCheck } from '@/lib/calendar/booking-form';

const questions: Question[] = [
  { id: 'name', label: 'Name', kind: 'text', required: true },
  { id: 'topic', label: 'Topic', kind: { choice: { options: ['Sales', 'Support'] } }, required: false },
  { id: 'notes', label: 'Notes', kind: 'long_text', required: false },
];

describe("an invitee's answers", () => {
  it('pass when every required question is answered, trimmed, skipping empty optional ones', () => {
    expect(checkAnswers(questions, new Map([['name', '  Lee Park '], ['topic', 'Sales'], ['notes', ' ']]))).toEqual({
      ok: true, answers: [{ question_id: 'name', value: 'Lee Park' }, { question_id: 'topic', value: 'Sales' }],
    });
  });

  it('name a missing required answer, a choice not offered, and a question not asked', () => {
    const check: FormCheck = checkAnswers(questions, new Map([['name', ' '], ['topic', 'Legal'], ['age', '40']]));
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect([...check.errors.keys()].sort()).toEqual(['age', 'name', 'topic']);
    expect(check.errors.get('name')).toBe('Name is required.');
  });
});
