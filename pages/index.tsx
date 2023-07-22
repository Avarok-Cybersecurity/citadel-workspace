import { Layout } from '@components/common/Layout';
import React from 'react';
import Chat from '@components/chat';
import { useApiProvider } from '@framework';
import { useRegister_c2s } from '@common/c2s';
import { invoke } from '@tauri-apps/api/tauri';

export default function Home({
  cid,
  connErr,
}: {
  cid: string;
  connErr: string;
}) {
  const data = useApiProvider();
  const registerC2s = useRegister_c2s();
  return (
    <>
      <div className="flex flex-col justify-between">
        <button
          className="text-red-500"
          onClick={async () => {
            const data = await registerC2s({
              type: 'register',
              uuid: cid,
              fullName: 'John Doe ',
              username: 'johndoe',
              proposedPassword: '_Rudsakjdas123',
            });
            console.log('CID', cid);
            // const data = await invoke('register', {
            //   uuid: cid,
            //   fullName: 'John Doe ',
            //   username: 'johndoe',
            //   proposedPassword: '_Rudsakjdas123',
            // });
            // console.log(data);
          }}
        >
          Register
        </button>
        <main className="pt-10 h-full w-full flex flex-col justify-between">
          <span className="text-yellow-400">{cid}</span>
          <Chat />
        </main>
      </div>
    </>
  );
}

Home.Layout = Layout;
