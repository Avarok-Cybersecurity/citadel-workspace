/**
 * A workspace logo is drawn as what it is: an image as an image, an emoji or initials as text.
 *
 * Live (owner, 2026-09-27): an emoji workspace icon showed as a broken image. The switcher had two
 * branches, initials or `<img src={logo}>`, so an emoji went into `src`, failed to load, and the
 * `onError` handler hid it.
 *
 * No mocks: the component renders into jsdom.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceLogoMark } from '../WorkspaceLogoMark';

const PNG: string = 'data:image/png;base64,iVBORw0KGgo=';

describe('the workspace logo mark', () => {
  it('draws an emoji as text, never as an image', () => {
    render(<WorkspaceLogoMark logo={{ type: 'emoji', data: '🚀' }} name="Avarok" />);
    expect(screen.getByTestId('workspace-logo').textContent).toBe('🚀');
    expect(document.querySelector('img')).toBeNull();
  });

  it('draws an image as an image named after the workspace', () => {
    render(<WorkspaceLogoMark logo={{ type: 'image', data: PNG }} name="Avarok" />);
    const img: HTMLImageElement = screen.getByRole('img', { name: 'Avarok' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(PNG);
  });

  it('draws initials as text', () => {
    render(<WorkspaceLogoMark logo={{ type: 'initials', data: 'AL' }} name="Avarok Labs" />);
    expect(screen.getByTestId('workspace-logo').textContent).toBe('AL');
  });
});
