import { Layout } from '@components/common/Layout';
import React from 'react';
import { useRegister_c2s } from '@framework/c2s';
import { useAppSelector } from 'framework/redux/store';
import genUuid from '@lib/utils';

export default function Home({ connErr }: { connErr: string }) {
  const registerC2s = useRegister_c2s();

  const { uuid } = useAppSelector((state) => {
    return state.uuid;
  });

  return (
    <>
      <div className="flex flex-col justify-between">
        <button
          className="text-red-500"
          onClick={async () => {
            const username = genUuid();
            console.log('Username', username);
            await registerC2s({
              uuid: uuid,
              fullName: 'John Doe ',
              serverAddr: '127.0.0.1:12349',
              username,
              proposedPassword: '_Rudsakjdas123',
            });
          }}
        >
          Register
        </button>

        <main className="pt-10 h-full w-full flex flex-col justify-between"></main>
      </div>
    </>
  );
}

Home.Layout = Layout;
