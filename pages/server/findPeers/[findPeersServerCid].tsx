import { Layout } from '@components/common/Layout';
import AddPeerCard from '@components/ui/addPeerCard';
import { useGetAllPeers_c2s } from '@framework/c2s';
import { useAppSelector } from 'framework/redux/store';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

const FindPeers = () => {
  const currentSessionInUse = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );

  const router = useRouter();
  const { uuid } = useAppSelector((state) => state.uuid);

  const getAllPeers = useGetAllPeers_c2s();

  const peers = useAppSelector((state) => state.context.peers);

  useEffect(() => {
    getAllPeers({ uuid, cid: Number(currentSessionInUse) });
    console.log('Smth', peers);
  }, []);

  return (
    <div className="text-4xl text-teal-50 text-center mb-[50%] select-none">
      <div className="flex gap-x-4 flex-wrap gap-y-4 ml-4 mt-4">
        <AddPeerCard />
        <AddPeerCard />
        <AddPeerCard />
        <AddPeerCard />
        <AddPeerCard />
        <AddPeerCard />
        <AddPeerCard />
        <AddPeerCard />
        <AddPeerCard />
      </div>
    </div>
  );
};

export default FindPeers;

FindPeers.Layout = Layout;
