import React, { useState } from 'react';

import _ from 'lodash';

function Chat() {
  // const [messages, setMessages] = useState<IMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  // const [currentUser, setCurrentUser] = useState('User1');
  // const handleSend = () => {
  //   // append the new message to the current list of messages
  //   setMessages((messages) => [
  //     ...messages,
  //     { user: currentUser, message: messageInput, timestamp: new Date() },
  //   ]);
  //   // clear the input field
  //   setMessageInput('');
  // };
  // const handleUserChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  //   setCurrentUser(event.target.value);
  // };
  // const [label, setLab] = useState('Standart');
  return (
    <div className="pl-4 h-full">
      <div className="relative right-2 ">
        <input
          type="text"
          className="p-2.5 placeholder:text-white text-white bg-gray-600 border-inherit w-full text-sm outline-none appearance-none mb-3 rounded-lg"
          placeholder="Message"
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
        />
        <button
          className="absolute top-0 appearance-none right-0 border-inherit outline-none p-2.5 text-sm font-medium text-white"
          onClick={() => {
            // if (messageInput) handleSend();
          }}
        ></button>
      </div>
    </div>
  );
}

export default Chat;
