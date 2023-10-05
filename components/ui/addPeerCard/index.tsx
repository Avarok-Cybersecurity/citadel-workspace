import { useP2PRegister } from '@framework/p2p';
import { EnvelopeIcon, PlusIcon } from '@heroicons/react/20/solid';
import { useAppSelector } from 'framework/redux/store';

export default function AddPeerCard({
  online_status,
  userId,
}: {
  userId: string;
  online_status?: boolean;
}) {
  const currentSessionInUse = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );

  const registerToPeer = useP2PRegister();
  return (
    <div className="bg-gray-600 px-4 py-5 sm:px-6 text-white rounded-md">
      <div className="-ml-4 -mt-4 flex-wrap items-center justify-center sm:flex-nowrap ">
        <div className="mt-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <span className="relative inline-block">
                <img
                  className="h-10 w-10 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 "
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                  alt=""
                />
                <span className="absolute bottom-0 right-0 block h-2 w-2 rounded-full bg-green-400 ring-2 ring-white" />
              </span>{' '}
            </div>
            <div className="ml-4">
              <h3 className="text-base font-semibold leading-6">Tom Cook</h3>
              <p className="text-sm">
                <a href="#">@tom_cook</a>
              </p>
            </div>
          </div>
        </div>
        <div className="ml-4 mt-4 flex flex-shrink-0">
          <button
            onClick={() =>
              registerToPeer({ myCid: currentSessionInUse, peerCid: userId })
            }
            type="button"
            className="relative inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            <PlusIcon
              className="-ml-0.5 mr-1.5 h-5 w-5 text-gray-400"
              aria-hidden="true"
            />
            <span>Connect</span>
          </button>
        </div>
      </div>
    </div>
  );
}
