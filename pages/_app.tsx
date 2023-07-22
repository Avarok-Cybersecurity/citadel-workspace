import { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';
import '../tailwind.css';
import { FC, ReactNode, useEffect, useState } from 'react';
import { UIProvider } from '@components/ui/context';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import {
  ServiceConnectionAccepted,
  ServiceRegisterAccepted,
  ServiceTCPConnectionAccepted,
} from '@common/types/c2s';

const Noop: FC<{ children: ReactNode }> = ({ children }) => <>{children}</>;

function CustomApp({
  Component,
  pageProps,
}: AppProps & { Component: { Layout: FC<{ children: ReactNode }> } }) {
  const [cid, setCid] = useState('');
  const [connErr, setErr] = useState('');

  useEffect(() => {
    const gen = async () => {
      if (cid) return;
      try {
        await invoke<string>('open_tcp_conn');
      } catch (error) {
        setErr(error as string);
      }
    };

    const unlisten = listen('open_conn', (event: any) => {
      const payload: ServiceTCPConnectionAccepted = JSON.parse(event.payload);
      console.log(payload);

      setCid(payload.ServiceConnectionAccepted.id);
    });

    // const unlisten_register = listen('register', (event: any) => {
    //   const payload: ServiceRegisterAccepted = JSON.parse(event.payload);
    //   console.log(payload);
    // });

    // const unlisten_conn_c2s = listen('connect', (event: any) => {
    //   const payload: ServiceConnectionAccepted = JSON.parse(event.payload);
    //   console.log('Payload' + payload);
    // });

    gen();
  }, [cid]);
  const Layout = Component.Layout ?? Noop;
  return (
    <div className="select-none">
      <Head>
        <title>Citadel</title>
        <link
          href="https://cdnjs.cloudflare.com/ajax/libs/flowbite/1.6.6/flowbite.min.css"
          rel="stylesheet"
        />
      </Head>
      <div className="min-h-screen flex flex-col">
        <Script
          id="flowbite"
          src="https://cdnjs.cloudflare.com/ajax/libs/flowbite/1.6.6/flowbite.min.js"
        />
        <main className="flex-grow bg-gray-100 shadow-inner">
          <UIProvider>
            <Layout>
              <Component {...pageProps} cid={cid} connErr={connErr} />
            </Layout>
          </UIProvider>
        </main>
      </div>
    </div>
  );
}

export default CustomApp;
