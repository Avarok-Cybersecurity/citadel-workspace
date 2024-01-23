import { RootState, useAppDispatch, useAppSelector } from 'redux/store';
import Link from 'next/link';
import React from 'react';
import { setCurrentServer } from 'redux/slices/streamHandler.slice';
import clsx from 'clsx';

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

  const dispatch = useAppDispatch();

  return (
    <div id="workspace" className="items-center px-2 bg-gray-800 py-5 ">
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
          console.log(key);
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
    </div>
  );
}

export default WorkspaceBar;
