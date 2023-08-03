import { Layout } from '@components/common/Layout';
import React from 'react';
import Chat from '@components/chat';
import { useRegister_c2s } from '@framework/c2s';
import { useDispatch, useSelector } from 'react-redux';
import { State } from 'framework/redux/store';
import genUuid from '@lib/utils';
import { execute } from 'framework/redux/slices/streamHandler.slice';

export default function Home({ connErr }: { connErr: string }) {
  const registerC2s = useRegister_c2s();
  const dispatch = useDispatch();
  const { uuid } = useSelector((state: State) => {
    return state.uuid;
  });

  return (
    <>
      <div className="flex flex-col justify-between">
        <button
          className="text-red-500"
          onClick={async () => {
            const req_id = await registerC2s({
              uuid: uuid,
              fullName: 'John Doe ',
              serverAddr: '127.0.0.1:12349',
              username: genUuid(),
              proposedPassword: '_Rudsakjdas123',
            });

            dispatch(execute({ req_id, data: null }));
            console.log('Got the req_id register');
          }}
        >
          Register
        </button>

        <main className="pt-10 h-full w-full flex flex-col justify-between">
          {/* <span className="text-yellow-400">{uuid.to_string()}</span> */}
          <Chat />
        </main>
      </div>
    </>
  );
}

Home.Layout = Layout;
