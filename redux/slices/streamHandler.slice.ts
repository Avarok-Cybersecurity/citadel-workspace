import { ListAllPeers } from '@common/types/c2sResponses';
import { createSlice, current, PayloadAction } from '@reduxjs/toolkit';

type Sessions = {
  current_used_session_server: string;
  current_sessions: {
    [key: string | number]: { [key: string]: string | boolean };
  };
};
export type ContextType =
  | 'RegisterAndConnect'
  | 'GetSession'
  | 'ListAllPeers'
  | 'Disconnect'
  // p2p
  | 'PeerRegister'
  | 'PeerConnect'
  | 'PeerDisconnect';

const initialState: {
  context: {
    [key: string]: ContextType;
  };
  sessions: Sessions;
} = {
  context: {},
  sessions: {
    current_used_session_server: '',
    current_sessions: {},
  },
};

const streamExecSlice = createSlice({
  name: 'stram_handler',
  initialState,
  reducers: {
    addToContext: (
      state,
      action: PayloadAction<{ req_id: string; context_type: ContextType }>
    ) => {
      const req_id = action.payload.req_id;

      const context_type: ContextType =
        action.payload.context_type ?? state.context[req_id];
      const payload: { [key: string]: string | number } = action.payload;
      console.log('payload', payload);

      let updatedObject: { [key: string]: string | number } = {};

      for (const key in payload) {
        if (key != 'request_id') {
          updatedObject[key] = payload[key];
        }
      }

      state.context[req_id] = context_type;
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
    setCurrentSessionPeers: (state, action: PayloadAction<ListAllPeers>) => {
      const cid = action.payload.cid;
      const online_statuses = action.payload.online_status;
      state.sessions.current_sessions[cid] = online_statuses;
    },
    setCurrentServer: (state, action) => {
      state.sessions.current_used_session_server = action.payload;
    },
  },
});

const { reducer, actions } = streamExecSlice;
export const {
  addToContext,
  setSessions,
  setCurrentServer,
  setCurrentSessionPeers,
} = actions;
export default reducer;
