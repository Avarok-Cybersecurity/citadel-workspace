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
        <Aside onClose={closeSidebar} isOpen={isSidebarOpen} />

        <div className="p-4 sm:ml-64">
          <div className="p-4 border-2 border-dashed rounded-lg border-gray-700 mt-14">
            {children}
          </div>
        </div>
      </div>
    </ApiProvider>
  );
};
