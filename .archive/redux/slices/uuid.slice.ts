import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  uuid: '',
};
const showSwitchToBusinessOverlaySlice = createSlice({
  name: 'uuid',
  initialState,
  reducers: {
    setUuid: (state, action) => {
      state.uuid = action.payload;
    },
  },
});

const { reducer, actions } = showSwitchToBusinessOverlaySlice;
export const { setUuid } = actions;
export default reducer;
