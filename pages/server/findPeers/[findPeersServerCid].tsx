import { Layout } from '@components/common/Layout';
import { useGetAllPeers_c2s } from '@framework/c2s';
import { useAppSelector } from 'framework/redux/store';
import { useEffect } from 'react';

const FindPeers = () => {
  const currentSessionInUse = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );

  const { uuid } = useAppSelector((state) => state.uuid);

  const getAllPeers = useGetAllPeers_c2s();
  getAllPeers({ uuid, cid: Number(currentSessionInUse) });

  const peers = useAppSelector((state) => state.context.peers);

  useEffect(() => {
    console.log('Smth', peers);
  }, []);

  return (
    <div className="text-4xl text-teal-50 text-center mb-[50%] select-none">
      <h1>Welcome to the Citadel Server</h1>
      <h2>Find Peers</h2>
    </div>
  );
};

export default FindPeers;

FindPeers.Layout = Layout;
