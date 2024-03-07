import { ListAllPeers } from '@common/types/c2sResponses';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { LosslessNumber } from 'lossless-json';

type Sessions = {
  current_used_session_server: string;
  current_sessions: {
    [key: string]: { [key: string]: string | boolean };
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
  | 'PeerDisconnect'
  | 'ListRegisteredPeers';

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
  name: 'stream_handler',
  initialState,
  reducers: {
    addToContext: (
      state,
      action: PayloadAction<{ req_id: string; context_type: ContextType }>
    ) => {
      const req_id = action.payload.req_id;

      const context_type: ContextType =
        action.payload.context_type ?? state.context[req_id];
      const payload: { [key: string]: string } = action.payload;

      let updatedObject: { [key: string]: string } = {};

      for (const key in payload) {
        if (key != 'request_id') {
          updatedObject[key] = payload[key];
        }
      }

      state.context[req_id] = context_type;
    },
    setSessions: (state, action) => {
      const activeSessions: Array<{
        cid: LosslessNumber;
        peer_connections: {};
      }> = action.payload;

      for (const session of activeSessions) {
        const cid = session.cid;
        const peer_connections = session.peer_connections;
        state.sessions.current_sessions[cid.value] = peer_connections;
      }
    },
    removeServerSession: (state, action) => {
      const cid = action.payload;
      delete state.sessions.current_sessions[cid];
    },
    setCurrentSessionPeers: (state, action: PayloadAction<ListAllPeers>) => {
      const cid = action.payload.cid;
      const online_statuses = action.payload.online_status;
      state.sessions.current_sessions[cid.value] = online_statuses;
    },
    setCurrentServer: (state, action) => {
      state.sessions.current_used_session_server = action.payload;
    },
    setRegisteredPeers: (state, action) => {
      const cid = action.payload.cid;
      const peers = action.payload.peers;
      state.sessions.current_sessions[cid.value].registeredPeers = peers;
    },
  },
});

const { reducer, actions } = streamExecSlice;
export const {
  addToContext,
  setSessions,
  setCurrentServer,
  setCurrentSessionPeers,
  removeServerSession,
  setRegisteredPeers,
} = actions;
export default reducer;
