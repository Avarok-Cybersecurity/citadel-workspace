import { Layout } from '@components/common/Layout';
import { useAppSelector } from '@redux/store';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import useListAllPeers from '@hooks/c2s/useListAllPeers';

const FindPeers = () => {
  const pathname = usePathname();

  const current_selected_session = useAppSelector(
    (state) => state.context.sessions.current_used_session_server
  );

  useEffect(() => {
    useListAllPeers({ cid: current_selected_session });
    return () => {};
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
