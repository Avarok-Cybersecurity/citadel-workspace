import type { Meta, StoryFn, StoryObj } from '@storybook/react';

import WorkspaceAvatar from './WorkspaceAvatar';

// More on how to set up stories at: https://storybook.js.org/docs/react/writing-stories/introduction
export default {
  title: 'Components/ Avatar',
  component: WorkspaceAvatar,
  // tags: ['autodocs'],
} as Meta;

export const Avatar: StoryFn = () => <WorkspaceAvatar />;
