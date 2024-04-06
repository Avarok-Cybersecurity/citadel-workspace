import { PeerRegisterNotification } from '@common/types/c2sResponses';
import { createSlice, current, PayloadAction } from '@reduxjs/toolkit';

const initialState: {
  [key: string]: Array<any>;
} = {};

const notificationsContext = createSlice({
  name: 'notifications_handler',
  initialState,
  reducers: {
    addToNotificationsContext: (
      state,
      action: PayloadAction<{
        key: string;
        payload: PeerRegisterNotification;
      }>
    ) => {
      console.log('Payload', action.payload.payload.payload.cid.value);
      if (!state[action.payload.payload.payload.cid.value])
        state[action.payload.payload.payload.cid.value] = [];

      state[action.payload.payload.payload.cid.value].push(
        action.payload.payload.payload as PeerRegisterNotification
      );
      console.log('State', current(state));
    },
    deleteFromNotificationsContext: (
      state,
      action: PayloadAction<{ peerCid: string; cid: string }>
    ) => {
      const { cid, peerCid } = action.payload;

      state[cid] = state[cid].filter(
        (peer) => peer.cid.value !== cid && peer.peer_cid.value !== peerCid
      );
    },
  },
});

const { reducer, actions } = notificationsContext;
export const { addToNotificationsContext, deleteFromNotificationsContext } =
  actions;
export default reducer;
