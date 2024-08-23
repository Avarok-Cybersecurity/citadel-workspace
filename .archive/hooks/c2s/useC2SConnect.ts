import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type RegisterAndConnectInput = {
  fullName: string;
  username: string;
  proposedPassword: string;
  serverAddr: string;
};
export const serverConnect = async (input: RegisterAndConnectInput) => {
  const response = invoke<RegisterAndConnectInput, string>(
    'register',
    input,
  ).then((response) => {
    store.dispatch(
      addToContext({
        req_id: response,
        context_type: 'RegisterAndConnect',
      }),
    );
    setTimeout(() => {
      invoke('get_sessions').then((req_id) => {
        store.dispatch(
          addToContext({
            req_id,
            context_type: 'GetSession',
          }),
        );
      });
    }, 1000);
  });
  return response;
};

export default serverConnect;
