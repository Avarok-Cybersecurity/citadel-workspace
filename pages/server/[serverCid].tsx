import { Layout } from '@components/common/Layout';
import useListAllPeers from '@hooks/c2s/useListAllPeers';
const Server = () => {
  return (
    <div className="text-4xl text-teal-50 text-center mb-[50%] select-none">
      <h1>Welcome to the Citadel Server</h1>
      <h2>Click on Discussions to enter the chat</h2>
    </div>
  );
};

export default Server;

Server.Layout = Layout;
