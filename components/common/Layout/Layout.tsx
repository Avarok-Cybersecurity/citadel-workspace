import React from 'react';
import { ApiProvider } from '@framework/index';

type Props = {
  children: React.ReactNode;
};
export const Layout = ({ children }: Props) => {
  return (
    <ApiProvider>
      <div>{children}</div>
    </ApiProvider>
  );
};
