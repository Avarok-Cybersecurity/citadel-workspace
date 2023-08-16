import { ContextType } from '../';
import { AppDispatch } from '../index';

export const addToContext =
  (req_id: string, context_type: ContextType) => (dispatch: any) => {
    dispatch({ type: 'ADD_TO_CONTEXT', payload: { req_id, context_type } });
  };

export const handleStreamPacketInContext =
  (req_id: string, payload: { [key: string]: any }) =>
  (dispatch: AppDispatch) => {
    dispatch({ type: 'HANDLE_PACKET', payload: { req_id, payload } });
  };
