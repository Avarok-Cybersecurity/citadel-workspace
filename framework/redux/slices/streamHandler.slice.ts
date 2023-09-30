import {
  ServiceRegisterAccepted,
  ServiceTCPConnectionAccepted,
} from '@common/types/c2s';
import { createSlice, current } from '@reduxjs/toolkit';

type Data = ServiceRegisterAccepted | ServiceTCPConnectionAccepted;

type Sessions = {
  current_used_session_server: string;

  current_sessions: {
    [key: string]: { [key: string]: string };
  };
};
export type ContextType = 'Register' | 'GetSession' | 'getAllPeers';

const initialState: {
  context: {
    [key: string]: ContextType;
  };
  peers: {
    [key: string]: { online_status: { [key: string]: boolean }; cid: string };
  };
  sessions: Sessions;
} = {
  context: {},
  peers: {},
  sessions: {
    current_used_session_server: '',
    current_sessions: {},
  },
};

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
      const activeSessions: Array<{
        cid: string;
        peer_connections: {};
      }> = action.payload;

      console.log('Before', activeSessions);
      for (const session of activeSessions) {
        const cid = session.cid;
        const peer_connections = session.peer_connections;
        state.sessions.current_sessions[cid] = peer_connections;
      }

      console.log('active sessions', activeSessions);
      console.log('Current state', current(state));
    },
    setCurrentServer: (state, action) => {
      state.sessions.current_used_session_server = action.payload;
    },
    setAllPeersOfTheServer: (state, action) => {
      state.peers[state.sessions.current_used_session_server] = action.payload;
      console.log('peers state', current(state.peers));
    },
  },
});

const { reducer, actions } = streamExecSlice;
export const {
  addToContext,
  setSessions,
  setCurrentServer,
  setAllPeersOfTheServer,
} = actions;
export default reducer;
