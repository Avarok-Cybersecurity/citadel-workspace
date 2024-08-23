import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type DisconnectInput = {
  cid: string;
};
export default async function useDisconnect(
  input: DisconnectInput,
): Promise<string> {
  const response = await invoke<{ cid: string }, string>('disconnect', input);
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'Disconnect',
    }),
  );

  return response;
}
