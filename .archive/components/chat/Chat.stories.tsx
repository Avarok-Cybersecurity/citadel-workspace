import { Meta, StoryFn } from '@storybook/react';
import Chat from './Chat';

export default {
  title: 'Components / MessageInput',
} as Meta;

export const MessageInput: StoryFn = () => (
  <div className="">
    <Chat />
  </div>
);
