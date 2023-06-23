import React from 'react';
import { Dropdown, DropdownProps, DropdownItemProps } from 'flowbite-react';

function Chat() {
  return (
    <div className="">
      <form>
        <div className="flex">
          <label
            htmlFor="search-dropdown"
            className="mb-2 text-sm font-medium text-gray-900 sr-only dark:text-white"
          >
            Your Email
          </label>
          <Dropdown label="Security type" className={'w-20'}>
            <Dropdown.Item>Shopping</Dropdown.Item>
            <Dropdown.Item>Images</Dropdown.Item>
            <Dropdown.Item>News</Dropdown.Item>
            <Dropdown.Item>Finance</Dropdown.Item>
          </Dropdown>

          {/* <div className="relative w-full">
            <input
              type="search"
              id="search-dropdown"
              className="block p-2.5 w-full z-20 text-sm text-gray-900 bg-gray-50 rounded-r-lg border-l-gray-100 border-l-2 border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:border-blue-500"
              placeholder="Message"
            />
            <button
              type="button"
              className="absolute top-0 right-0 p-2.5 text-sm font-medium text-white bg-blue-700 rounded-r-lg border border-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            >
              Send
            </button>
          </div> */}
        </div>
      </form>
    </div>
  );
}

export default Chat;
