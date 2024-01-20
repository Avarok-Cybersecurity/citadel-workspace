import { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';
import '../tailwind.css';
import { FC, ReactNode, useEffect, useState } from 'react';
import { UIProvider } from '@components/ui/context';
import { listen } from '@tauri-apps/api/event';
import { Provider } from 'react-redux';
import { invoke } from '@tauri-apps/api/core';
import store from 'redux/store';
import { setUuid } from 'redux/slices/uuid.slice';
import {
  addToContext,
  setCurrentSessionPeers,
  setSessions,
} from 'redux/slices/streamHandler.slice';
import { GetSessions, ListAllPeers, Payload } from '@common/types/c2sResponses';

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
          addr: '127.0.0.1:12345',
        });
        store.dispatch(setUuid(uuid_value));

        const session_req_id: string = await invoke('get_sessions', {
          uuid: uuid_value,
        });
        store.dispatch(
          addToContext({
            req_id: session_req_id,
            context_type: 'GetSession',
          })
        );
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

        const req_id = payload.request_id;
        handlePacket(req_id, payload);
      }
    );

    return () => {
      listen_packet_stream.then((unlisten) => unlisten());
    };
  }, []);

  const handlePacket = (req_id: string, payload: Payload) => {
    const { context: map } = store.getState();
    console.log('Map', map);
    const context = map.context[req_id];
    console.log('Payload', payload);
    console.log('Context', context);

    if (context) {
      switch (context) {
        case 'GetSession':
          const getSessionsPayload: Payload = payload as GetSessions;
          const activeSessions = getSessionsPayload.sessions;
          store.dispatch(setSessions(activeSessions));
          break;
        case 'ListAllPeers':
          const peers: Payload = payload as ListAllPeers;
          setCurrentSessionPeers(peers);
          break;
        default:
          console.log('default');
          break;
      }
    }
  };

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
