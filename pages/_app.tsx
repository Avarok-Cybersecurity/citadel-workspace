import { AppProps } from 'next/app';
import Head from 'next/head';
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
      </Head>
      <div className="min-h-screen flex flex-col">
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
