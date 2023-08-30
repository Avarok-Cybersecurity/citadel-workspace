import { Layout } from '@components/common/Layout';
import React from 'react';
import Chat from '@components/chat';
import { useRouter } from 'next/router';
import { useAppSelector } from 'framework/redux/store';

export default function SpecificServer({ connErr }: { connErr: string }) {
  const router = useRouter();
  const serverCid = router.query.server;

  // const current_used_session_server = useAppSelector(
  //   (state) => state.context.sessions.current_used_session_server
  // );

  return (
    <>
      <div className="flex flex-col justify-between">
        <main className="pt-10 h-full w-full flex flex-col justify-between text-white">
          <Chat />
        </main>
      </div>
    </>
  );
}

SpecificServer.Layout = Layout;
