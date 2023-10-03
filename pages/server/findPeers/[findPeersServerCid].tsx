import { Layout } from '@components/common/Layout';
import AddPeerCard from '@components/ui/addPeerCard';
import { useGetAllPeers_c2s } from '@framework/c2s';
import { useAppSelector } from 'framework/redux/store';
import { useEffect } from 'react';

const FindPeers = () => {
  const currentSessionInUse = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );

  const getAllPeers = useGetAllPeers_c2s();

  useEffect(() => {
    getAllPeers({ cid: currentSessionInUse });
  }, [currentSessionInUse]);

  const peers_state = useAppSelector(
    (state) => state.context.peers[currentSessionInUse]?.online_status
  );
  const state = useAppSelector((state) => state.context.peers);
  console.log('Peers state', state);
  console.log('Current session', currentSessionInUse);

  return (
    <div className="text-4xl text-teal-50 text-center mb-[50%] select-none">
      <div className="flex gap-x-4 flex-wrap gap-y-4 ml-4 mt-4">
        <ul
          role="list"
          className="mx-auto mt-5 grid max-w-2xl text-white grid-cols-2 gap-x-8 gap-y-16 text-center sm:grid-cols-3 md:grid-cols-4 lg:mx-0 lg:max-w-none lg:grid-cols-5 xl:grid-cols-6"
        >
          {peers_state ? (
            Object.keys(peers_state).map((key) => {
              return (
                <AddPeerCard
                  key={key}
                  userId={key}
                  // online_status={peers_state[key] as boolean}
                />
              );
            })
          ) : (
            <></>
          )}
        </ul>
      </div>
    </div>
  );
};

export default FindPeers;

FindPeers.Layout = Layout;
