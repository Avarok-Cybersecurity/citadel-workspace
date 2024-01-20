import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type RegisterAndConnectInput = {
  fullName: string;
  username: string;
  proposedPassword: string;
  serverAddr: string;
};
export const serverConnect = async (
  input: RegisterAndConnectInput
): Promise<string> => {
  const response = await invoke<RegisterAndConnectInput, string>(
    'register',
    input
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'RegisterAndConnect',
    })
  );
  const req_id = await invoke('get_sessions');
  store.dispatch(
    addToContext({
      req_id,
      context_type: 'GetSession',
    })
  );
  return response;
};

export default serverConnect;
