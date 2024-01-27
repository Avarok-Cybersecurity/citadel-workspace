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
  removeServerSession,
  setCurrentServer,
  setCurrentSessionPeers,
  setSessions,
} from 'redux/slices/streamHandler.slice';
import {
  Disconnect,
  GetSessions,
  ListAllPeers,
  Payload,
} from '@common/types/c2sResponses';
import { useRouter } from 'next/navigation';
import JSONbig from 'json-bigint';

const Noop: FC<{ children: ReactNode }> = ({ children }) => <>{children}</>;

function CustomApp({
  Component,
  pageProps,
}: AppProps & { Component: { Layout: FC<{ children: ReactNode }> } }) {
  const [_connErr, setErr] = useState('');
  const router = useRouter();

  useEffect(() => {
    const connect = async () => {
      try {
        const uuid_value: string = await invoke('open_connection', {
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
        const response = JSONbig.parse(event.payload);
        const key = Object.keys(response.packet).at(0)!;
        const data = { payload: response.packet[key], error: response.error };
        console.log('response dataaaaaaaaa', data.payload.cid);

        const req_id = data.payload.request_id;
        handlePacket(req_id, data);
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
          const getSessionsPayload = payload.payload as GetSessions;
          const activeSessions = getSessionsPayload.sessions;
          console.log('activeSessions', activeSessions);
          store.dispatch(setSessions(activeSessions));
          console.log('got a getSessions req ', getSessionsPayload);
          console.log('GetSessions', getSessionsPayload);
          console.log('activeSessions', store.getState().context.sessions);
          break;
        case 'ListAllPeers':
          const peers = payload.payload as ListAllPeers;
          setCurrentSessionPeers(peers);
          break;
        case 'Disconnect':
          const disconnect = payload.payload as Disconnect;
          console.log('Disconnect', disconnect);
          router.push('/');
          store.dispatch(removeServerSession(disconnect.cid));
          store.dispatch(setCurrentServer(''));
          break;
        default:
          console.log('default');
          break;
      }
    }
  };

  const Layout = Component.Layout ?? Noop;
  return (
    <div className="select-none h-screen">
      <Head>
        <title>Citadel</title>
      </Head>
      <div className="min-h-screen h-screen flex flex-col " id="workspace">
        <Script
          id="flowbite"
          src="https://cdnjs.cloudflare.com/ajax/libs/flowbite/1.6.6/flowbite.min.js"
        />
        <main
          className="flex-grow bg-gray-100 shadow-inner h-screen"
          id="workspace"
        >
          <Provider store={store}>
            <UIProvider>
              <Layout>
                <Component id="workspace" {...pageProps} />
              </Layout>
            </UIProvider>
          </Provider>
        </main>
      </div>
    </div>
  );
}

export default CustomApp;
