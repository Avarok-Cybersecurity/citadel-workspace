import Chat from '@components/chat';
import { Layout } from '@components/common/Layout';
import useListAllPeers from '@hooks/c2s/useListAllPeers';
import useListRegisteredPeers from '@hooks/p2p/useListRegisteredPeers';
import { useAppSelector } from '@redux/store';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
const Server = () => {
  const current_selected_session = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );
  const router = useRouter();
  const { peerId } = router.query;

  useEffect(() => {
    // useListAllPeers({ cid: current_selected_session });
    // useListRegisteredPeers({ cid: current_selected_session });

    return () => {};
  }, []);

  return (
    <div className="text-4xl flex flex-col justify-end text-teal-50 text-center h-[calc(100vh-5.5rem)] select-none">
      <Chat peer_cid={peerId!} />
    </div>
  );
};

export default Server;

Server.Layout = Layout;
