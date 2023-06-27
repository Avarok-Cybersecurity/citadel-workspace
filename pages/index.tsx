import Chat from '@/components/chat/Chat';
import { Layout } from '@/components/common/Layout';
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useUI } from '@/components/ui/context';

export default function Home() {
  const [mess, setMess] = useState('');
  const [err, setErr] = useState();
  useEffect(() => {
    invoke<string>('open_tcp_conn')
      .then((res) => {
        console.log(res);
      })
      .catch(console.error);
  }, []);
  const { isSidebarOpen } = useUI();
  return (
    <div className="h-full flex flex-col justify-end">
      <p className="text-blue">{mess}</p>
      <p className="text-red">{err}</p>
      {isSidebarOpen ? 'E deschis' : 'Nu'}
      <Chat />
    </div>
  );
}

Home.Layout = Layout;
