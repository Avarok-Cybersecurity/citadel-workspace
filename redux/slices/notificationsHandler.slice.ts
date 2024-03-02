import { PeerRegisterNotification } from '@common/types/c2sResponses';
import { createSlice, current, PayloadAction } from '@reduxjs/toolkit';

const initialState: {
  [key: string]: Array<any>;
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
      console.log('Sdsada', action.payload.payload);
      state[action.payload.payload.cid.value] = [];
      state[action.payload.payload.cid.value].push(
        action.payload.payload as PeerRegisterNotification
      );
      console.log(current(state));
    },
    deleteFromNotificationsContext: (
      state,
      action: PayloadAction<{ peerCid: string; cid: string }>
    ) => {
      console.log('Action payload', action.payload);
      const { cid, peerCid } = action.payload;

      state[cid] = state[cid].filter(
        (peer) => peer.cid.value !== cid && peer.peer_cid.value !== peerCid
      );
      console.log('Current state', current(state));
    },
  },
});

const { reducer, actions } = notificationsContext;
export const { addToNotificationsContext, deleteFromNotificationsContext } =
  actions;
export default reducer;
