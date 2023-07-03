import Chat from '@/components/chat/Chat';
import { Layout } from '@/components/common/Layout';
import React from 'react';

export default function Home({
  cid,
  connErr,
}: {
  cid: string;
  connErr: string;
}) {
  return (
    <div className="h-full flex flex-col justify-end">
      <p className="text-blue">Your cid {cid}</p>
      <Chat />
    </div>
  );
}

Home.Layout = Layout;
