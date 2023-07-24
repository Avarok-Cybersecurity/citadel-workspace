import { configureStore } from '@reduxjs/toolkit';
import uuid from './slices/uuid.slice';

const stringMiddleware =
  () =>
  (next: any) =>
  (action: string | { type: string; payload?: unknown }) => {
    if (typeof action === 'string') {
      return next({ type: action });
    }
    return next(action);
  };

const store = configureStore({
  reducer: { uuid },
  devTools: process.env.NODE_ENV !== 'production',
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(stringMiddleware),
});

export default store;

export interface State {
  [key: string]: { uuid: string };
}
