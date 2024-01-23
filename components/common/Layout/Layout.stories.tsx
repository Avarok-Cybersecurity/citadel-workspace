import { Meta, StoryFn } from '@storybook/react';
import { Layout as Lay } from './Layout';

export default {
  title: 'Components / Layout',
} as Meta;

export const Layout: StoryFn = () => (
  <Lay>
    <p>Hi</p>
    <p>Hi</p>
    <p>Hi</p>
    <p>Hi</p>
    <p>Hi</p>
  </Lay>
);
