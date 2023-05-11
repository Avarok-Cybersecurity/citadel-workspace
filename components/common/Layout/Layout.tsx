import React, { FC } from 'react';
import { Aside } from '../Navbar';
import { Header } from '../Header';
import { useUI } from '@components/ui/context';
import { ApiProvider } from '@framework/app/index';

type Props = {
  children: React.ReactNode;
};
export const Layout = ({ children }: Props) => {
  const { isSidebarOpen, closeSidebar } = useUI();
  return (
    <ApiProvider>
      <div>
        <Header />

        <div className="block">
          <Aside onClose={closeSidebar} isOpen={isSidebarOpen} />
        </div>

        <div className="p-4 sm:ml-92 pl-20 sm:pl-[335px]">
          <div className="p-4 border-2 border-dashed rounded-lg border-gray-700 mt-16 ">
            {children}
          </div>
        </div>
      </div>
    </ApiProvider>
  );
};
