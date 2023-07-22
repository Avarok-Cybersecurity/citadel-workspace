import { Layout } from '@components/common/Layout';
import React from 'react';
import Chat from '@components/chat';
import { useRegister_c2s } from '@framework/c2s';

export default function Home({
  uuid,
  connErr,
}: {
  uuid: string;
  connErr: string;
}) {
  console.log(connErr);
  console.log(uuid);
  const registerC2s = useRegister_c2s();
  return (
    <>
      <div className="flex flex-col justify-between">
        <button
          className="text-red-500"
          onClick={async () => {
            const data = await registerC2s({
              uuid,
              fullName: 'John Doe ',
              username: 'johndoe',
              serverAddr: '192.168.9.1',
              proposedPassword: '_Rudsakjdas123',
            });
            console.log(data);
          }}
        >
          Register
        </button>
        <button
          className="text-red-500 mt-20"
          onClick={async () => {
            const data = await registerC2s({
              uuid,
              fullName: 'John Doe',
              serverAddr: '',
              username: 'johndoe',
              proposedPassword: '_Rudsakjdas123',
            });
            console.log(data);
          }}
        ></button>
        <main className="pt-10 h-full w-full flex flex-col justify-between">
          {/* <span className="text-yellow-400">{uuid.to_string()}</span> */}
          <Chat />
        </main>
      </div>
    </>
  );
}

Home.Layout = Layout;
