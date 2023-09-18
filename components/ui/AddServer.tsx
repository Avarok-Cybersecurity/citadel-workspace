import { useRegister_c2s } from '@framework/c2s';
import { RootState } from 'framework/redux/store';
import { Dispatch, SetStateAction, useState } from 'react';
import { useSelector } from 'react-redux';

export default function AddServerModal({
  onCloseNavbar,
  onClose,
}: {
  onCloseNavbar: Dispatch<SetStateAction<boolean>>;
  onClose: Dispatch<SetStateAction<boolean>>;
}) {
  onCloseNavbar(false);
  const register = useRegister_c2s();
  const { uuid } = useSelector((state: RootState) => state.uuid);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [proposedPassword, setProposedPassword] = useState('');
  const [ipAddr, setIpAddr] = useState('');
  return (
    <>
      <div className="flex min-h-full flex-1 rounded-md flex-col justify-center py-12 sm:px-6 lg:px-8 z-[100]">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="h-screen absolute opacity-70 bg-black w-screen transform -translate-x-1/2 -translate-y-1/2 z-[80] top-1/2 left-1/2 font-bold leading-9 tracking-tight text-gray-900"></h2>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px] z-[100] rounded-lg">
          <div className="bg-white px-6 py-12 shadow sm:rounded-lg sm:px-12 rounded-lg">
            <button
              onClick={() => onClose(false)}
              type="button"
              className="absolute top-24 md:top-28 sm:right-16 right-4 text-black bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 ml-auto inline-flex justify-center items-center dark:hover:bg-gray-600 dark:hover:text-white"
              data-modal-hide="authentication-modal"
            >
              <svg
                className="w-3 h-3"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 14 14"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                />
              </svg>
              <span className="sr-only">Close modal</span>
            </button>
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const data = await register({
                  uuid,
                  fullName,
                  serverAddr: ipAddr,
                  username,
                  proposedPassword,
                });
                console.log(data);
                onClose(false);
              }}
            >
              <div>
                <label
                  htmlFor="string"
                  className="block text-sm font-medium leading-6 text-gray-900"
                >
                  Full name
                </label>
                <div className="mt-2">
                  <input
                    onChange={(e) => setFullName(e.target.value)}
                    value={fullName}
                    id="fullName"
                    name="fullName"
                    type="string"
                    required
                    className="block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="string"
                  className="block text-sm font-medium leading-6 text-gray-900"
                >
                  Username
                </label>
                <div className="mt-2">
                  <input
                    id="username"
                    onChange={(e) => setUsername(e.target.value)}
                    value={username}
                    name="username"
                    type="string"
                    required
                    className="block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="number"
                  className="block text-sm font-medium leading-6 text-gray-900"
                >
                  Proposed password
                </label>
                <div className="mt-2">
                  <input
                    onChange={(e) => setProposedPassword(e.target.value)}
                    value={proposedPassword}
                    id="password"
                    name="password"
                    type="password"
                    required
                    className="block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="number"
                  className="block text-sm font-medium leading-6 text-gray-900"
                >
                  IP address of the server
                </label>
                <div className="mt-2">
                  <input
                    onChange={(e) => setIpAddr(e.target.value)}
                    value={ipAddr}
                    id="number"
                    name="email"
                    type="string"
                    autoComplete="email"
                    required
                    className="block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                  />
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  Register
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
