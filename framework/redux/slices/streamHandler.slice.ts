import {
  ServiceRegisterAccepted,
  ServiceTCPConnectionAccepted,
} from '@common/types/c2s';
import { createSlice, current } from '@reduxjs/toolkit';

type Data = ServiceRegisterAccepted | ServiceTCPConnectionAccepted;

export type ContextType = 'Register' | 'GetSession';

const initialState: {
  context: {
    [key: string]: ContextType;
  };
  sessions: Array<{ cid: string; peer_connections: { [key: string]: string } }>;
} = { context: {}, sessions: [] };

const streamExecSlice = createSlice({
  name: 'stram_handler',
  initialState,
  reducers: {
    addToContext: (state, action) => {
      console.log('Before', current(state));
      console.log('Action', action);
      const req_id = action.payload.req_id;

      const context_type: ContextType =
        action.payload.context_type ?? state.context[req_id];
      console.log('Action payload', action.payload);
      console.log('Context Type', context_type);
      const payload: { [key: string]: string | number } =
        action.payload.payload;

      let updatedObject: { [key: string]: string | number } = {};

      for (const key in payload) {
        if (key != 'request_id') {
          updatedObject[key] = payload[key];
        }
      }

      state.context[req_id] = context_type;
      console.log('After', current(state));
    },
    setSessions: (state, action) => {
      const activeSessions: Array<any> = action.payload;

      const inactiveSession = state.sessions.filter((item) => {
        return !activeSessions.includes(item);
      });

      state.sessions = activeSessions;

      console.log('inactiveSession', inactiveSession);
      console.log('active sessions', activeSessions);
    },
  },
});

const { reducer, actions } = streamExecSlice;
export const { addToContext, setSessions } = actions;
export default reducer;
