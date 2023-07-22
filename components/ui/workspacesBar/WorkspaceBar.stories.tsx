import type { Meta, StoryFn } from '@storybook/react';

import WorkspaceBar from './WorkspaceBar';
import { SetStateAction } from 'react';

export default {
  title: 'Components/ Bar',
  component: WorkspaceBar,
} as Meta;

export const Bar: StoryFn = () => <WorkspaceBar />;
