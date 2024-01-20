import { configureStore } from '@reduxjs/toolkit';
import uuid from './slices/uuid.slice';
import executor from './slices/streamHandler.slice';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';

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
  reducer: { uuid, context: executor },
  devTools: process.env.NODE_ENV !== 'production',
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(stringMiddleware),
});

export default store;

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
