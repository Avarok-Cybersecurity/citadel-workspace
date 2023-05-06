import { AppProps } from 'next/app';
import Head from 'next/head';
import '../tailwind.css';

function CustomApp({ Component, pageProps }: AppProps) {
  return (
    <div className="select-none">
      <Head>
        <title>Citadel</title>
      </Head>
      <div className="min-h-screen flex flex-col">
        <main className="flex-grow bg-gray-100 shadow-inner">
          <Component {...pageProps} />
        </main>
      </div>
    </div>
  );
}

export default CustomApp;
