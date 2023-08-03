import {
  ServiceRegisterAccepted,
  ServiceTCPConnectionAccepted,
} from '@common/types/c2s';
import { createSlice, current } from '@reduxjs/toolkit';

interface ContextAction {
  payload: Data;
  context_type: ContextType;
}

type Data = ServiceRegisterAccepted | ServiceTCPConnectionAccepted;

export type ContextType = 'Register';

const initialState: { [key: string]: ContextAction | null } = {};

const streamExecSlice = createSlice({
  name: 'stram_handler',
  initialState,
  reducers: {
    execute: (state, action) => {
      console.log('Before', current(state));
      console.log('Action', action);
      const req_id = action.payload.req_id;
      const context_type =
        action.payload.context_type ?? state[req_id]?.context_type;
      console.log('Type: ', context_type);

      const context: ContextAction = {
        payload: action.payload.data,
        context_type: context_type && context_type,
      };

      state[req_id] = context;
      console.log('After', current(state));
    },
  },
});

const { reducer, actions } = streamExecSlice;
export const { execute } = actions;
export default reducer;
