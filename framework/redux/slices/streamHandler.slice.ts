import {
  ServiceRegisterAccepted,
  ServiceTCPConnectionAccepted,
} from '@common/types/c2s';
import { createSlice, current } from '@reduxjs/toolkit';

interface ContextAction {
  context_data: { [key: string]: any };
  context_type: ContextType;
}

type Data = ServiceRegisterAccepted | ServiceTCPConnectionAccepted;

export type ContextType = 'Register' | 'GetSession';

const initialState: { [key: string]: ContextAction | null } = {};

const streamExecSlice = createSlice({
  name: 'stram_handler',
  initialState,
  reducers: {
    addToContext: (state, action) => {
      console.log('Before', current(state));
      console.log('Action', action);
      const req_id = action.payload.req_id;

      const context_type =
        action.payload.context_type ?? state[req_id]?.context_type;

      const payload: { [key: string]: string | number } =
        action.payload.payload;

      let updatedObject: { [key: string]: string | number } = {};

      for (const key in payload) {
        if (key != 'request_id') {
          updatedObject[key] = payload[key];
        }
      }

      const context: ContextAction = {
        context_data: updatedObject,
        context_type: context_type,
      };

      state[req_id] = context;
      console.log('After', current(state));
    },
  },
});

const { reducer, actions } = streamExecSlice;
export const { addToContext } = actions;
export default reducer;
