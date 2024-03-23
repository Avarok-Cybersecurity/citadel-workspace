import useSendMessage from '@hooks/messages/useSendMessage';
import { useAppSelector } from '@redux/store';
import React, { useState } from 'react';

function Chat({ peer_cid }: { peer_cid: string }) {
  const current_selected_session = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );
  const [messageInput, setMessageInput] = useState('');

  return (
    <div className="pl-4">
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
            useSendMessage({
              cid: current_selected_session,
              message: messageInput,
              peerCid: peer_cid,
            });
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            className="w-6 h-6 mt-1"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default Chat;
