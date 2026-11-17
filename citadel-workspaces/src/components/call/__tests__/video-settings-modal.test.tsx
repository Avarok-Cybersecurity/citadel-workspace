/**
 * Choosing a video quality.
 *
 * The modal is a radiogroup, and the parts worth asserting are the ones a
 * screen reader depends on and a mouse user never sees: that exactly one option
 * is checked, that picking one reports it, and that the cost of each is on
 * screen rather than in a tooltip.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { VideoSettingsModal } from '../VideoSettingsModal';
import { VIDEO_QUALITY_OPTIONS } from '@/lib/call/video-quality-options';

afterEach(cleanup);

describe('the video settings modal', () => {
  it('offers every quality, as radios in one group', () => {
    render(
      <VideoSettingsModal open onOpenChange={() => {}} quality="auto" onQualityChange={() => {}} />,
    );
    const group: HTMLElement = screen.getByRole('radiogroup', { name: 'Video quality' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(VIDEO_QUALITY_OPTIONS.length);
  });

  it('marks exactly one as chosen, and it is the current one', () => {
    render(
      <VideoSettingsModal
        open
        onOpenChange={() => {}}
        quality="saver"
        onQualityChange={() => {}}
      />,
    );
    const checked: HTMLElement[] = screen
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAttribute('data-testid', 'video-quality-saver');
  });

  it('reports the choice as soon as it is made', async () => {
    // No Save button, deliberately: the effect is visible in the call within a
    // second, and a modal that makes somebody commit before they can see what
    // they chose is a modal that gets cancelled.
    const onQualityChange: ReturnType<typeof vi.fn> = vi.fn();
    render(
      <VideoSettingsModal open onOpenChange={() => {}} quality="auto" onQualityChange={onQualityChange} />,
    );
    await userEvent.click(screen.getByTestId('video-quality-balanced'));
    expect(onQualityChange).toHaveBeenCalledWith('balanced');
  });

  it('says what each one costs, on screen', () => {
    // The choice is about bandwidth. A list of four adjectives with the numbers
    // hidden is a list nobody can choose from.
    render(
      <VideoSettingsModal open onOpenChange={() => {}} quality="auto" onQualityChange={() => {}} />,
    );
    for (const option of VIDEO_QUALITY_OPTIONS) {
      expect(screen.getByText(option.approxBitrate)).toBeInTheDocument();
      expect(screen.getByText(option.detail)).toBeInTheDocument();
    }
  });
});
