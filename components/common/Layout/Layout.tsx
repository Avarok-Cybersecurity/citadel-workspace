import React, { FC } from 'react';
import { Aside } from '../Navbar';
import { Header } from '../Header';
type Props = {
  children: React.ReactNode; //👈 children prop typr
};
export const Layout = (props: Props) => {
  return (
    <>
      <Header />
      <Aside />

      <div className="p-4 sm:ml-64">
        <div className="p-4 border-2 border-gray-200 border-dashed rounded-lg dark:border-gray-700 mt-14">
          {props.children}
        </div>
      </div>
    </>
  );
};
