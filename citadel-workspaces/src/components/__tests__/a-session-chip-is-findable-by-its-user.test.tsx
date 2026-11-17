/**
 * A session chip must be findable by the username, whatever the person is
 * called.
 *
 * Three specs looked for `button[title*="${username}"]`. The chip's title is
 * `${full_name || username} - ${workspaceName}`, so it contains the username
 * only when the two happen to be the same string.
 *
 * They are, today, and only by accident: `createAccount` fills the Full Name
 * field WITH the username. So those locators work — and would stop working for
 * any account named like a person, in a spec whose whole verdict is "did the
 * session strip appear". One of them, `multi-tab-sync`, carries a KNOWN PRODUCT
 * BUG annotation that rests entirely on this read.
 *
 * To be clear about what this is and is not: it does NOT explain that failure.
 * The username and full name match there, so the old locator did match. It
 * removes a coincidence that the conclusion was resting on.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrphanSessionIcon } from '../OrphanSessionIcon';

const SESSION: Parameters<typeof OrphanSessionIcon>[0]['session'] = {
  cid: 42n,
  username: 'ada_1787',
  full_name: 'Ada Lovelace',
  server_address: '127.0.0.1:12349',
} as unknown as Parameters<typeof OrphanSessionIcon>[0]['session'];

describe('a session chip', () => {
  it('is addressable by username even when the person has a full name', () => {
    render(
      <OrphanSessionIcon
        session={SESSION}
        workspaceName="Design"
        onNavigate={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.getByTestId('session-button-ada_1787')).toBeInTheDocument();

    // And the reason the old locator could not find it, stated as a fact rather
    // than left as a guess: the title is about the PERSON, not the account.
    const chip: HTMLElement = screen.getByTestId('session-button-ada_1787');
    expect(chip.getAttribute('title')).toBe('Ada Lovelace - Design');
    expect(chip.getAttribute('title')).not.toContain('ada_1787');
  });
});
