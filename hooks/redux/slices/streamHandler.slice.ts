import { createSlice } from '@reduxjs/toolkit';

type Sessions = {
  current_used_session_server: string;
  current_sessions: {
    [key: string]: { [key: string]: string };
  };
};
export type ContextType = 'Register' | 'GetSession';

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
    addToContext: (state, action) => {
      const req_id = action.payload.req_id;

      const context_type: ContextType =
        action.payload.context_type ?? state.context[req_id];
      const payload: { [key: string]: string | number } =
        action.payload.payload;

      let updatedObject: { [key: string]: string | number } = {};

      for (const key in payload) {
        if (key != 'request_id') {
          updatedObject[key] = payload[key];
        }
      }

      state.context[req_id] = context_type;
    },

    setCurrentServer: (state, action) => {
      state.sessions.current_used_session_server = action.payload;
    },
  },
});

const { reducer, actions } = streamExecSlice;
export const { addToContext, setCurrentServer } = actions;
export default reducer;
