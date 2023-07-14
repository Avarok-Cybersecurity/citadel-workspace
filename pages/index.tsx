import { Layout } from '@components/common/Layout';
import React from 'react';
import { Fragment, useState } from 'react';
import { Dialog, Menu, Transition } from '@headlessui/react';
import { Button, Tooltip } from 'flowbite-react';
import {
  Bars3Icon,
  BellIcon,
  CalendarIcon,
  ChartPieIcon,
  Cog6ToothIcon,
  DocumentDuplicateIcon,
  FolderIcon,
  HomeIcon,
  UsersIcon,
  XMarkIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';
import {
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/20/solid';
import classNames from 'classnames';
import Chat from '@components/chat';
import ServerAvatar from '@components/ui/serverAvatar';
import WorkspaceBar from '@components/ui/workspacesBar/WorkspaceBar';
import { useApiProvider } from '@framework';

const navigation = [
  { name: 'Dashboard', href: '#', icon: HomeIcon, current: true },
  { name: 'Team', href: '#', icon: UsersIcon, current: false },
  { name: 'Projects', href: '#', icon: FolderIcon, current: false },
  { name: 'Calendar', href: '#', icon: CalendarIcon, current: false },
  { name: 'Storage', href: '#', icon: DocumentDuplicateIcon, current: false },
  { name: 'Security', href: '#', icon: ChartPieIcon, current: false },
];
const teams = [
  { id: 1, name: 'Radu Cazacu', href: '#', initial: 'R', current: false },
  { id: 2, name: 'Thomas Braun', href: '#', initial: 'T', current: false },
  { id: 3, name: 'Jiahang Li', href: '#', initial: 'J', current: false },
];
const userNavigation = [
  { name: 'Your profile', href: '#' },
  { name: 'Sign out', href: '#' },
];

export default function Home({
  cid,
  connErr,
}: {
  cid: string;
  connErr: string;
}) {
  const data = useApiProvider();
  console.log(data);
  return (
    <>
      <div className="flex flex-col justify-between">
        <main className="pt-10 h-full w-full flex flex-col justify-between">
          {cid}
          <Chat />
        </main>
      </div>
    </>
  );
}

Home.Layout = Layout;
