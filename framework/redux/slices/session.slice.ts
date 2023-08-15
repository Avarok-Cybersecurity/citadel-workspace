import { createSlice, current } from '@reduxjs/toolkit';

const initialState = {
  sessions: [],
};
const showSwitchToBusinessOverlaySlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setSessions: (state, action) => {
      const activeSessions = action.payload.sessions;
      activeSessions.forEach((session: any) => {
        if (!state.sessions.includes(session)) {
          state.sessions.push(session);
        }
      });
      const inactiveSession = state.sessions.filter((item) => {
        return !activeSessions.includes(item);
      });

      console.log('inactiveSession', inactiveSession);
      console.log('active sessions', activeSessions);
    },
  },
});

const { reducer, actions } = showSwitchToBusinessOverlaySlice;
export const { setSessions } = actions;
export default reducer;
