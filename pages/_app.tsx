import { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';
import '../tailwind.css';
import { FC, ReactNode, useEffect, useState } from 'react';
import { UIProvider } from '@components/ui/context';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { Provider } from 'react-redux';
import store from 'framework/redux/store';
import { setUuid } from 'framework/redux/slices/uuid.slice';
import { execute } from 'framework/redux/slices/streamHandler.slice';
// import { useGetSession_c2s } from '@framework/c2s';

const Noop: FC<{ children: ReactNode }> = ({ children }) => <>{children}</>;

function CustomApp({
  Component,
  pageProps,
}: AppProps & { Component: { Layout: FC<{ children: ReactNode }> } }) {
  const [connErr, setErr] = useState('');
  useEffect(() => {
    const connect = async () => {
      try {
        const uuid_value: string = await invoke('open_tcp_conn', {
          addr: '127.0.0.1:3000',
        });
        store.dispatch(setUuid(uuid_value));
        const session_id: string = await invoke('get_session', {
          uuid: uuid_value,
        });
        store.dispatch(
          execute({
            req_id: session_id,
            data: null,
            context_type: 'Sessions',
          })
        );
        console.log('Session ID', session_id);
      } catch (error) {
        console.log(error);
        setErr(error as string);
      }
    };
    connect();

    const listen_packet_stream = listen(
      'packet_stream',
      (event: { payload: string }) => {
        const data = JSON.parse(event.payload);
        const key = Object.keys(data).at(0)!;
        const payload = data[key];

        console.log('Stream_packet', payload);
        const req_id = payload.request_id;
        console.log('ReqID stream', req_id);
        store.dispatch(execute({ req_id, payload }));
      }
    );

    return () => {
      listen_packet_stream.then((unlisten) => unlisten());
    };
  }, []);

  const Layout = Component.Layout ?? Noop;
  return (
    <div className="select-none">
      <Head>
        <title>Citadel</title>
      </Head>
      <div className="min-h-screen flex flex-col">
        <Script
          id="flowbite"
          src="https://cdnjs.cloudflare.com/ajax/libs/flowbite/1.6.6/flowbite.min.js"
        />
        <main className="flex-grow bg-gray-100 shadow-inner">
          <Provider store={store}>
            <UIProvider>
              <Layout>
                <Component {...pageProps} />
              </Layout>
            </UIProvider>
          </Provider>
        </main>
      </div>
    </div>
  );
}

export default CustomApp;
