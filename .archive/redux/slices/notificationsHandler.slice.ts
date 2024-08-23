import { PeerRegisterNotification } from '@common/types/c2sResponses';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

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
      }>,
    ) => {
      state[action.payload.payload.cid.value] = [];
      state[action.payload.payload.cid.value].push(
        action.payload.payload as PeerRegisterNotification,
      );
    },
    deleteFromNotificationsContext: (
      state,
      action: PayloadAction<{ peerCid: string; cid: string }>,
    ) => {
      const { cid, peerCid } = action.payload;

      state[cid] = state[cid].filter(
        (peer) => peer.cid.value !== cid && peer.peer_cid.value !== peerCid,
      );
    },
  },
});

const { reducer, actions } = notificationsContext;
export const { addToNotificationsContext, deleteFromNotificationsContext } =
  actions;
export default reducer;
