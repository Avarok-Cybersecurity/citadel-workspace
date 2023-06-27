import Chat from '@/components/chat/Chat';
import { Layout } from '@/components/common/Layout';
import React, { useEffect, useState } from 'react';
import Greet from '@/components/tauri-components/greet';
import { invoke } from '@tauri-apps/api/tauri';
import { useUI } from '@/components/ui/context';

export default function Home() {
  const [mess, setMess] = useState('');
  useEffect(() => {
    invoke<string>('greet', { name: 'Next.js' })
      .then(setMess)
      .catch(console.error);
  }, []);
  const { isSidebarOpen } = useUI();
  return (
    <div className="h-full flex flex-col justify-end">
      {mess}
      {isSidebarOpen ? 'E deschis' : 'Nu'}
      <Chat />
    </div>
  );
}

Home.Layout = Layout;
