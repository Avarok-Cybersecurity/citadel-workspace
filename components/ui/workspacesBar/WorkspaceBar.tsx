import { RootState, useAppDispatch, useAppSelector } from 'redux/store';
import Link from 'next/link';
import React, { useState } from 'react';
import { setCurrentServer } from 'redux/slices/streamHandler.slice';
import clsx from 'clsx';
import listAllPeers from '@hooks/c2s/useListAllPeers';
import peerRegister from '@hooks/p2p/usePeerRegister';
import { deleteFromNotificationsContext } from '@redux/slices/notificationsHandler.slice';
import useListRegisteredPeers from '@hooks/p2p/useListRegisteredPeers';

function WorkspaceBar({
  setAddServerOpener,
}: {
  setAddServerOpener: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const sessions = useAppSelector(
    (state: RootState) => state.context.sessions.current_sessions
  );

  const currentSessionInUse = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );

  const currentNotification = useAppSelector(
    (state) => state.notificationsContext
  );

  const dispatch = useAppDispatch();
  const [openedNotification, setOpenedNotification] = useState(false);

  return (
    <div
      id="workspace"
      className="items-center flex justify-between px-2 bg-gray-800 py-5 "
    >
      <div className="flex gap-x-5">
        <span
          className="inline-flex h-12 w-12 items-center cursor-pointer justify-center rounded-full bg-[#8aa29e] text-center"
          onClick={() => {
            setAddServerOpener(true);
          }}
        >
          <span className="text-xl font-medium leading-none text-white">+</span>
        </span>
        {Object.keys(sessions).map((key, i) => {
          return (
            <div
              key={key}
              className={clsx(
                currentSessionInUse === key && 'bg-slate-300',
                'rounded'
              )}
            >
              <Link
                key={key}
                href={{
                  pathname: `/server/${key}`,
                }}
                onClick={() => {
                  listAllPeers({
                    cid: key,
                  });
                  useListRegisteredPeers({ cid: key });
                  dispatch(setCurrentServer(key));
                }}
              >
                <img
                  key={i}
                  className="inline-block h-12 w-12 rounded-full"
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                  alt=""
                />
              </Link>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setOpenedNotification(!openedNotification)}
        id="dropdownNotificationButton"
        data-dropdown-toggle="dropdownNotification"
        className="relative inline-flex items-center text-sm font-medium text-center text-white hover:text-white focus:outline-none dark:hover:text-white dark:text-white"
        type="button"
      >
        <svg
          className="w-6 h-6"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          viewBox="0 0 14 20"
        >
          <path d="M12.133 10.632v-1.8A5.406 5.406 0 0 0 7.979 3.57.946.946 0 0 0 8 3.464V1.1a1 1 0 0 0-2 0v2.364a.946.946 0 0 0 .021.106 5.406 5.406 0 0 0-4.154 5.262v1.8C1.867 13.018 0 13.614 0 14.807 0 15.4 0 16 .538 16h12.924C14 16 14 15.4 14 14.807c0-1.193-1.867-1.789-1.867-4.175ZM3.823 17a3.453 3.453 0 0 0 6.354 0H3.823Z" />
        </svg>

        <div className="absolute block w-3 h-3 bg-red-500 border-2 border-white rounded-full -top-0.5 start-2.5 dark:border-gray-900"></div>
      </button>
      {openedNotification && (
        <>
          <div
            id="dropdownNotification"
            className="z-20 absolute w-full max-w-sm bg-white top-16 right-0 divide-y divide-gray-100 rounded-lg shadow dark:bg-gray-800 dark:divide-gray-700"
            aria-labelledby="dropdownNotificationButton"
          >
            <div className="block px-4 py-2 font-medium text-center text-gray-700 rounded-t-lg bg-gray-50 dark:bg-gray-800 dark:text-white">
              Notifications
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 py-2 px-4">
              <div className="flex">
                {currentNotification[currentSessionInUse] &&
                  currentNotification[currentSessionInUse].map(
                    (notification) => {
                      return (
                        <div className="ms-3 text-sm font-normal">
                          <span className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
                            Friend request
                          </span>
                          <div className="mb-2 text-sm font-normal">
                            User {notification.peer_cid.value} wants to be
                            friends with you
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <button
                                onClick={() => {
                                  peerRegister({
                                    cid: currentSessionInUse,
                                    peerCid: notification.peer_cid.value,
                                  });
                                  dispatch(
                                    deleteFromNotificationsContext({
                                      cid: currentSessionInUse,
                                      peerCid: notification.peer_cid.value,
                                    })
                                  );
                                }}
                                className="inline-flex justify-center w-full px-2 py-1.5 text-xs font-medium text-center text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-800"
                              >
                                Accept
                              </button>
                            </div>
                            <div>
                              <span
                                onClick={() => {
                                  dispatch(
                                    deleteFromNotificationsContext({
                                      cid: currentSessionInUse,
                                      peerCid: notification.peer_cid.value,
                                    })
                                  );
                                }}
                                className="inline-flex cursor-pointer justify-center w-full px-2 py-1.5 text-xs font-medium text-center text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 dark:bg-gray-600 dark:text-white dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:border-gray-700 dark:focus:ring-gray-700"
                              >
                                Not now
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )}
              </div>
            </div>
            <Link
              href="#"
              className="block py-2 text-sm font-medium text-center text-gray-900 rounded-b-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-white"
            >
              <div className="inline-flex items-center ">
                <svg
                  className="w-4 h-4 me-2 text-gray-500 dark:text-gray-400"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 20 14"
                >
                  <path d="M10 0C4.612 0 0 5.336 0 7c0 1.742 3.546 7 10 7 6.454 0 10-5.258 10-7 0-1.664-4.612-7-10-7Zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
                </svg>
                View all
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default WorkspaceBar;
