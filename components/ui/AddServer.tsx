import { Dispatch, SetStateAction } from 'react';

export default function AddServerModal({
  onClose,
}: {
  onClose: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <>
      <div className="flex min-h-full flex-1 rounded-md flex-col justify-center py-12 sm:px-6 lg:px-8 z-[100]">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="mt-6 text-center text-2xl h-screen absolute opacity-70 bg-black w-screen transform -translate-x-1/2 -translate-y-[52.45%] z-[80] top-1/2 left-1/2 font-bold leading-9 tracking-tight text-gray-900">
            Register to a new server
          </h2>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px] z-[100]">
          <div className="bg-white px-6 py-12 shadow sm:rounded-lg sm:px-12">
            <button
              onClick={() => onClose(false)}
              type="button"
              className="absolute top-28 right-16 text-black bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 ml-auto inline-flex justify-center items-center dark:hover:bg-gray-600 dark:hover:text-white"
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
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                />
              </svg>
              <span className="sr-only">Close modal</span>
            </button>
            <form className="space-y-6" action="#" method="POST">
              <div>
                <label
                  htmlFor="number"
                  className="block text-sm font-medium leading-6 text-gray-900"
                >
                  IP address of the server
                </label>
                <div className="mt-2">
                  <input
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
