import Chat from '@/components/chat/Chat';
import { Layout } from '@/components/common/Layout';
import React from 'react';
import Greet from '@/components/tauri-components/greet';

export default function Home() {
  return (
    <div className="h-full flex flex-col justify-between">
      <Greet />
      <Chat />
    </div>
  );
}

Home.Layout = Layout;
