import Chat from '@/components/chat/Chat';
import { Layout } from '@/components/common/Layout';
import React from 'react';
import { useState } from 'react';

export default function Home() {

  return (
    <div className="h-full flex flex-col justify-between">
      <div>Test</div>
      <Chat />
    </div>
  );
}

Home.Layout = Layout;
