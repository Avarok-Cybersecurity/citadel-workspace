import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type DisconnectInput = {
  cid: string;
};
export default async function useDisconnect(
  input: DisconnectInput
): Promise<string> {
  console.log('useDisconnect');
  console.log(input);
  const response = await invoke<{ cid: string }, string>('disconnect', input);
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'Disconnect',
    })
  );
  const req_id = await invoke<{ uuid: string }, string>('get_sessions', {
    uuid: input.cid,
  });
  store.dispatch(
    addToContext({
      req_id,
      context_type: 'GetSession',
    })
  );
  return response;
}
