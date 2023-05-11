import { Meta, StoryFn } from '@storybook/react';
import Component from './index';

export default {
  title: 'Components / SearchBar',
  component: Component,
  args: {
    label: 'Vezi toate profesiile',
  },
} as Meta;

export const SearchBar: StoryFn = () => <Component />;
