import { Layout } from '@components/common/Layout';
import useDisconnect from '@hooks/c2s/useDisconnect';
import useListAllPeers from '@hooks/c2s/useListAllPeers';
import useListRegisteredPeers from '@hooks/p2p/useListRegisteredPeers';
import { useAppSelector } from '@redux/store';
import { useEffect } from 'react';
const Server = () => {
  const current_selected_session = useAppSelector(
    (state) => state.context.sessions.current_used_session_server,
  );

  useEffect(() => {
    useListAllPeers({ cid: current_selected_session });
    return () => {};
  }, []);

  return (
    <div className="text-4xl text-teal-50 text-center h-[calc(100vh-5.5rem)] select-none">
      <h1>Welcome to the Citadel Server</h1>
      <button
        className="bg-red-500 rounded-lg px-4 py-2 mt-4"
        onClick={() => {
          useDisconnect({ cid: current_selected_session });
        }}
      >
        Disconnect from the server
      </button>
      <button
        className="bg-blue-500 rounded-lg px-4 py-2 mt-4"
        onClick={() => {
          useListRegisteredPeers({ cid: current_selected_session });
          // ({ cid: current_selected_session });
        }}
      >
        Disconnect from the server
      </button>
    </div>
  );
};

export default Server;

Server.Layout = Layout;
