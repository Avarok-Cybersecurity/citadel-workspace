import Chat from '@/components/chat/Chat';
import { Layout } from '@/components/common/Layout';
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useUI } from '@/components/ui/context';

export default function Home() {
  const [mess, setMess] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    const gen = async () => {
      try {
        let x = await invoke<string>('open_tcp_conn');
        console.log(x);
      } catch (error) {
        console.log(error);
      }
    };
    gen();
  }, []);
  const { isSidebarOpen } = useUI();
  return (
    <div className="h-full flex flex-col justify-end">
      <p className="text-blue">{mess ? mess : 'Err'}</p>
      <p className="text-blue">{'HI'}</p>
      <p className="text-red">{err}</p>
      {isSidebarOpen ? 'E deschis' : 'Nu'}
      <Chat />
    </div>
  );
}

Home.Layout = Layout;
