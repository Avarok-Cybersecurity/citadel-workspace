import { ContextType } from '../';

type State = {
  context: { [key: string]: ContextType };
  sessions: { [key: string]: any };
};
export const contextReducer = (
  state: State = { context: {}, sessions: {} },
  action: { type: ContextType; payload: any }
) => {
  switch (action.type as ContextType) {
    case 'ADD_TO_CONTEXT':
      const { req_id, context_type } = action.payload;
      const newStateVariant = {
        ...state,
        context: { ...state.context, [req_id]: context_type },
      };
      console.log('add to context', newStateVariant);
      return newStateVariant;

    case 'HANDLE_PACKET':
      if (state.context[action.payload.req_id] === 'GetSession') {
        const newStateVariant = {
          ...state,
          sessions: {
            ...state.sessions,
            [action.payload.req_id]: action.payload,
          },
        };
        console.log('Handle packert', newStateVariant);
        return newStateVariant;
      } else if (
        state.context[action.payload.req_id] === 'RegisterAndConnect'
      ) {
      }

    default:
      return state;
  }
};
