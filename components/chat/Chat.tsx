import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { IMessage } from '@common/types/messages';
import dayjs from 'dayjs';
import { Dropdown } from 'flowbite-react';

import _ from 'lodash';

function Chat() {
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [currentUser, setCurrentUser] = useState('User1');
  const handleSend = () => {
    // append the new message to the current list of messages
    setMessages((messages) => [
      ...messages,
      { user: currentUser, message: messageInput, timestamp: new Date() },
    ]);
    // clear the input field
    setMessageInput('');
  };
  const handleUserChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentUser(event.target.value);
  };
  const [label, setLab] = useState('Standart');
  return (
    <div className="px-5">
      <div>
        {messages.map((message, index) => (
          <p key={index}>
            <b>{message.user}:</b> {message.message}{' '}
            <i>{message.timestamp.toLocaleTimeString()}</i>
          </p>
        ))}
      </div>
      <form>
        <div className="flex">
          <Dropdown label={label}>
            <Dropdown.Header>
              <span className="block text-sm">Security type</span>
            </Dropdown.Header>

            {label !== 'Standart' ? (
              <Dropdown.Item onClick={() => setLab('Standart')}>
                Standart
              </Dropdown.Item>
            ) : (
              <Dropdown.Item onClick={() => setLab('REVFS')}>
                REVFS
              </Dropdown.Item>
            )}
          </Dropdown>

          <div className="relative right-2 w-full">
            <input
              type="search"
              id="search-dropdown"
              className="block p-2.5 w-full z-20 text-sm text-gray-900 bg-gray-50 rounded-r-lg border-l-gray-100 border-l-2 border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:border-blue-500"
              placeholder="Message"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
            />
            <button
              type="button"
              className="absolute top-0 right-0 p-2.5 text-sm font-medium text-white bg-blue-700 rounded-r-lg border border-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              onClick={handleSend}
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default Chat;
