import { PeerRegisterNotification } from '@common/types/c2sResponses';
import { createSlice, current, PayloadAction } from '@reduxjs/toolkit';

const initialState: {
  [key: string]: [];
} = {};

const notificationsContext = createSlice({
  name: 'stream_handler',
  initialState,
  reducers: {
    addToNotificationsContext: (
      state,
      action: PayloadAction<{
        key: string;
        payload: PeerRegisterNotification;
      }>
    ) => {
      console.log('Adding to notifications context');
      console.log('Sdsada', action.payload.payload.peer_cid.value);
      state[action.payload.payload.peer_cid.value] = [];
      state[action.payload.payload.peer_cid.value].push(
        action.payload.payload as never
      );
      console.log(current(state));
    },
  },
});

const { reducer, actions } = notificationsContext;
export const { addToNotificationsContext } = actions;
export default reducer;
