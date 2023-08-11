import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  sessions: [],
};
const showSwitchToBusinessOverlaySlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setSession: (state, action) => {
      state.sessions = action.payload;
    },
  },
});

const { reducer, actions } = showSwitchToBusinessOverlaySlice;
export const { setSession } = actions;
export default reducer;
