import React, { FC } from 'react';
import { Aside } from '../Navbar';
import { Header } from '../Header';
import { useUI } from '@components/ui/context';
import { ApiProvider } from '@framework/index';

type Props = {
  children: React.ReactNode;
};
export const Layout = ({ children }: Props) => {
  const { isSidebarOpen, sidebar } = useUI();
  return (
    <ApiProvider>
      <div>
        <Header />

        <div className="block">
          <Aside />
        </div>

        <div className="pl-20 sm:pl-[335px]">
          <div className="pr-3 pb-4 pt-24 h-screen">{children}</div>
        </div>
      </div>
    </ApiProvider>
  );
};
