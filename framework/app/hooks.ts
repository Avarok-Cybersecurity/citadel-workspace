import { handler as useDisconnect_c2s } from './c2s/useDisconnect_c2s';
import { handler as useConnect_c2s } from './c2s/useConnect_c2s';
import { handler as useRegister_c2s } from './c2s/useRegister_c2s';
import { handler as useMessage } from './messaging/useMessage';
import { handler as useGetAccountInfo_c2s } from './c2s/useGetAccountInfo_c2s';

export const appHooks = {
  c2s: {
    useRegister: useRegister_c2s,
    useConnect: useConnect_c2s,
    useDisconnect: useDisconnect_c2s,
    useGetAccountInfo: useGetAccountInfo_c2s,
  },
  useMessage,
};
