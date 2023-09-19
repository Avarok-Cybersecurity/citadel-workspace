import React from 'react';
import { ApiProvider } from '@framework/index';
import { Fragment, useState } from 'react';
import { Dialog, Menu, Transition } from '@headlessui/react';
import { Button, Tooltip } from 'flowbite-react';
import {
  Bars3Icon,
  BellIcon,
  Cog6ToothIcon,
  DocumentDuplicateIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/20/solid';
import classNames from 'classnames';
import WorkspaceBar from '@components/ui/workspacesBar/WorkspaceBar';
import Link from 'next/link';
import AddServerModal from '@components/ui/AddServer';
import { useAppSelector } from 'framework/redux/store';
import { usePathname } from 'next/navigation';
const userNavigation = [
  { name: 'Your profile', href: '#' },
  { name: 'Sign out', href: '#' },
];

type Props = {
  children: React.ReactNode | React.ReactNode[];
};
// const navigation = ;
export const Layout = ({ children }: Props) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addServerOpen, setAddServerOpen] = useState(false);
  const currentUsedSessionCid: string = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );
  const pathname = usePathname();

  const [navigation, _] = useState([
    {
      name: 'Find Peers',
      href: `/server/findPeers/`,
      icon: UsersIcon,
      current: true,
    },
    {
      name: 'Storage',
      href: '/server/storage/',
      icon: DocumentDuplicateIcon,
      current: false,
    },
  ]);

  const current_sessions = useAppSelector(
    (state) => state.context.sessions.current_sessions
  );

  const peers = Object.keys(
    current_sessions[currentUsedSessionCid] ?? {}
  ).length;

  return (
    <ApiProvider>
      <div className="h-full">
        <Transition.Root show={sidebarOpen} as={Fragment}>
          <Dialog
            as="div"
            className="relative z-50 lg:hidden"
            onClose={setSidebarOpen}
          >
            <Transition.Child
              as={Fragment}
              enter="transition-opacity ease-linear duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity ease-linear duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-gray-900/80" />
            </Transition.Child>

            <div className="fixed inset-0 flex">
              <Transition.Child
                as={Fragment}
                enter="transition ease-in-out duration-300 transform"
                enterFrom="-translate-x-full"
                enterTo="translate-x-0"
                leave="transition ease-in-out duration-300 transform"
                leaveFrom="translate-x-0"
                leaveTo="-translate-x-full"
              >
                <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                  <Transition.Child
                    as={Fragment}
                    enter="ease-in-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in-out duration-300"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <div className="absolute left-full ml-8 top-0 flex w-16 justify-center pt-5">
                      <button
                        type="button"
                        className="-m-2.5  p-2.5"
                        onClick={() => setSidebarOpen(false)}
                      >
                        <span className="sr-only">Close sidebar</span>
                        <XMarkIcon
                          className="h-6 w-6 text-white"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </Transition.Child>
                  {/* Sidebar component, swap this element with another sidebar if you like */}
                  <div className="flex">
                    <WorkspaceBar onOpen={setAddServerOpen} />

                    <div className="flex grow w-72 flex-col gap-y-5 overflow-y-auto bg-gray-900 px-6 pb-4 ring-1 ring-white/10">
                      <Link
                        href={'/'}
                        className="flex h-16 shrink-0 items-center"
                      >
                        <img
                          className="h-8 w-auto"
                          src="https://github.com/Avarok-Cybersecurity/Citadel-Protocol/raw/master/resources/logo.png"
                          alt="Citadel Workspace"
                        />
                      </Link>
                      <nav className="flex flex-1 flex-col">
                        <ul
                          role="list"
                          className="flex flex-1 flex-col gap-y-7"
                        >
                          {pathname !== '/' && (
                            <li>
                              <ul role="list" className="-mx-2 space-y-1">
                                {navigation.map((item) => (
                                  <li key={item.name}>
                                    <Link
                                      onClick={() => {
                                        navigation.forEach((e) => {
                                          if (e.current === true)
                                            e.current = false;
                                          if (e.name === item.name) {
                                            e.current = true;
                                          }
                                        });
                                        setSidebarOpen(false);
                                      }}
                                      href={item.href + currentUsedSessionCid}
                                      className={classNames(
                                        item.current === true
                                          ? 'bg-gray-800 text-white'
                                          : 'text-gray-400 hover:text-white hover:bg-gray-800',
                                        'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold'
                                      )}
                                    >
                                      <item.icon
                                        className="h-6 w-6 shrink-0"
                                        aria-hidden="true"
                                      />
                                      {item.name}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          )}

                          <li>
                            <div className="text-xs font-semibold leading-6 text-gray-400">
                              Your Peers
                            </div>
                            <ul role="list" className="-mx-2 mt-2 space-y-1">
                              {peers === 0 ? (
                                <></>
                              ) : (
                                Object.keys(current_sessions).map((key) => (
                                  <li key={key}>
                                    <Link
                                      href={`/server/${currentUsedSessionCid}/${current_sessions[key]}`}
                                      className={classNames(
                                        key
                                          ? 'bg-gray-800 text-white'
                                          : 'text-gray-400 hover:text-white hover:bg-gray-800',
                                        'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold'
                                      )}
                                    >
                                      <span className="relative inline-block">
                                        <img
                                          className="h-6 w-6 rounded-full"
                                          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                                          alt=""
                                        />
                                        <span className="absolute bottom-0 right-0 block h-1.5 w-1.5 rounded-full bg-gray-300 ring-2 ring-white" />
                                      </span>
                                      <span className="truncate">{key}</span>
                                    </Link>
                                  </li>
                                ))
                              )}
                            </ul>
                          </li>
                          <li>
                            <div className="text-xs font-semibold leading-6 text-gray-400">
                              Security type
                            </div>
                            <div className="flex ">
                              <ul role="list" className="-mx-2 mt-2 space-y-1">
                                <li className="ml-2 flex items-center">
                                  <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                      type="checkbox"
                                      value=""
                                      className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>

                                    <span className="ml-3 text-sm font-medium text-gray-300">
                                      REVFS
                                    </span>
                                  </label>
                                </li>
                              </ul>
                              <Tooltip
                                style="dark"
                                className="text-black bg-white"
                                content="The security type defines how the data is transfered from the client to server. Default: Standart. REVFS stands for"
                              >
                                <Button className="ml-[100px] mt-1 w-6 h-6">
                                  ?
                                </Button>
                              </Tooltip>
                            </div>
                          </li>
                          <li className="mt-auto">
                            <Link
                              onClick={() => setSidebarOpen(false)}
                              href="/settings"
                              className="group -mx-2 flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6 text-gray-400 hover:bg-gray-800 hover:text-white"
                            >
                              <Cog6ToothIcon
                                className="h-6 w-6 shrink-0"
                                aria-hidden="true"
                              />
                              Settings
                            </Link>
                          </li>
                        </ul>
                      </nav>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </Dialog>
        </Transition.Root>

        {addServerOpen && (
          <div className="absolute z-[100] top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <AddServerModal
              onCloseNavbar={setSidebarOpen}
              onClose={setAddServerOpen}
            />
          </div>
        )}
        {/* Static sidebar for desktop */}
        <div
          className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-96"
          id="workspace"
        >
          <WorkspaceBar onOpen={setAddServerOpen} />
          {/* Sidebar component, swap this element with another sidebar if you like */}
          <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-900 px-6 pb-4">
            <Link href={'/'} className="flex h-16 shrink-0 items-center">
              <img
                className="h-8 mt-5 w-auto"
                src="https://github.com/Avarok-Cybersecurity/Citadel-Protocol/raw/master/resources/logo.png"
                alt="Citadel Workspace"
              />
            </Link>
            <nav className="flex flex-1 flex-col">
              <ul role="list" className="flex flex-1 flex-col gap-y-7">
                {pathname !== '/' && (
                  <li>
                    <ul role="list" className="-mx-2 space-y-1">
                      {navigation.map((item) => (
                        <li key={item.name}>
                          <Link
                            onClick={() => {
                              navigation.forEach((e) => {
                                if (e.current === true) e.current = false;
                                if (e.name === item.name) {
                                  e.current = true;
                                }
                                setSidebarOpen(false);
                              });
                            }}
                            href={item.href + currentUsedSessionCid}
                            className={classNames(
                              item.current
                                ? 'bg-gray-800 text-white'
                                : 'text-gray-400 hover:text-white hover:bg-gray-800',
                              'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold'
                            )}
                          >
                            <item.icon
                              className="h-6 w-6 shrink-0"
                              aria-hidden="true"
                            />
                            {item.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
                <li>
                  <div className="text-xs font-semibold leading-6 text-gray-400">
                    Your Peers
                  </div>
                  <ul role="list" className="-mx-2 mt-2 space-y-1">
                    {peers === 0 ? (
                      <></>
                    ) : (
                      Object.keys(current_sessions).map((key) => (
                        <li key={key}>
                          <Link
                            href={`/server/${currentUsedSessionCid}/${current_sessions[key]}`}
                            className={classNames(
                              key
                                ? 'bg-gray-800 text-white'
                                : 'text-gray-400 hover:text-white hover:bg-gray-800',
                              'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold'
                            )}
                          >
                            <span className="relative inline-block">
                              <img
                                className="h-6 w-6 rounded-full"
                                src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                                alt=""
                              />
                              <span className="absolute bottom-0 right-0 block h-1.5 w-1.5 rounded-full bg-gray-300 ring-2 ring-white" />
                            </span>
                            <span className="truncate">{key}</span>
                          </Link>
                        </li>
                      ))
                    )}
                  </ul>
                </li>
                {/* {sec type} */}
                <li>
                  <div className="text-xs font-semibold leading-6 text-gray-400">
                    Security type
                  </div>
                  <div className="flex ">
                    <ul role="list" className="-mx-2 mt-2 space-y-1">
                      <li className="ml-2 flex items-center">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            value=""
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>

                          <span className="ml-3 text-sm font-medium text-gray-300">
                            REVFS
                          </span>
                        </label>
                      </li>
                    </ul>
                    <Tooltip
                      style="dark"
                      className="text-black bg-white"
                      content="The security type defines how the data is transfered from the client to server. Default: Standart. REVFS stands for Remote Encrypted Virtual Filesystem"
                    >
                      <Button className="ml-[100px] mt-1 w-6 h-6">?</Button>
                    </Tooltip>
                  </div>
                </li>
                <li className="mt-auto">
                  <Link
                    onClick={() => setSidebarOpen(false)}
                    href="/settings"
                    className="group -mx-2 flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6 text-gray-400 hover:bg-gray-800 hover:text-white"
                  >
                    <Cog6ToothIcon
                      className="h-6 w-6 shrink-0"
                      aria-hidden="true"
                    />
                    Settings
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div
          className="lg:pl-96 h-[100vh] flex flex-col justify-between bg-gray-800"
          id="workspace"
        >
          <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center bg-gray-600 gap-x-4  border-gray-200 px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
            <button
              type="button"
              className="-m-2.5 p-2.5 text-gray-700 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <span className="sr-only">Open sidebar</span>
              <Bars3Icon className="h-6 w-6 text-white" aria-hidden="true" />
            </button>

            {/* Separator */}
            <div
              className="h-6 w-px bg-gray-900/10 lg:hidden"
              aria-hidden="true"
            />

            <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
              <form
                className="relative flex flex-1 "
                onSubmit={(e) => e.preventDefault()}
              >
                <label
                  htmlFor="search-field text-white color-white"
                  className="sr-only"
                >
                  Search
                </label>
                <MagnifyingGlassIcon
                  className="pointer-events-none absolute inset-y-0 left-0 h-full w-5 text-white"
                  aria-hidden="true"
                />
                <input
                  id="search-field"
                  className="block h-full w-full border-0 py-0 pl-8 pr-0 text-white bg-gray-600 placeholder:text-white focus:ring-0 sm:text-sm"
                  placeholder="Search..."
                  type="search"
                  name="search"
                />
              </form>
              <div className="flex items-center gap-x-4 lg:gap-x-6">
                <button
                  type="button"
                  className="-m-2.5 p-2.5 text-gray-400 hover:text-gray-500"
                >
                  <span className="sr-only">View notifications</span>
                  <BellIcon className="h-6 w-6 text-white" aria-hidden="true" />
                </button>

                {/* Separator */}
                <div
                  className="hidden lg:block lg:h-6 lg:w-px lg:bg-gray-900/10"
                  aria-hidden="true"
                />

                {/* Profile dropdown */}
                <Menu as="div" className="relative text-white">
                  <Menu.Button className="-m-1.5 flex items-center p-1.5">
                    <span className="sr-only">Open user menu</span>
                    <img
                      className="h-8 w-8 rounded-full bg-gray-50"
                      src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                      alt=""
                    />
                    <span className="hidden lg:flex lg:items-center">
                      <span
                        className="ml-4 text-sm font-semibold leading-6 text-white"
                        aria-hidden="true"
                      >
                        Tom Cook
                      </span>
                      <ChevronDownIcon
                        className="ml-2 h-5 w-5 text-gray-400"
                        aria-hidden="true"
                      />
                    </span>
                  </Menu.Button>
                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                  >
                    <Menu.Items className="absolute right-0 z-10 mt-2.5 w-32 origin-top-right rounded-md bg-white py-2 shadow-lg ring-1 ring-gray-900/5 focus:outline-none">
                      {userNavigation.map((item) => (
                        <Menu.Item key={item.name}>
                          {({ active }) => (
                            <Link
                              href={item.href}
                              className={classNames(
                                active ? 'bg-gray-50' : '',
                                'block px-3 py-1 text-sm leading-6 text-gray-900'
                              )}
                            >
                              {item.name}
                            </Link>
                          )}
                        </Menu.Item>
                      ))}
                    </Menu.Items>
                  </Transition>
                </Menu>
              </div>
            </div>
          </div>
          <div>{children}</div>
        </div>
      </div>
    </ApiProvider>
  );
};
