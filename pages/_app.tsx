import { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';
import '../tailwind.css';
import { FC, ReactNode } from 'react';
import { UIProvider } from '@/components/ui/context';

const Noop: FC<{ children: ReactNode }> = ({ children }) => <>{children}</>;

function CustomApp({
  Component,
  pageProps,
}: AppProps & { Component: { Layout: FC<{ children: ReactNode }> } }) {
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
              <Component {...pageProps} />
            </Layout>
          </UIProvider>
        </main>
      </div>
    </div>
  );
}

export default CustomApp;
