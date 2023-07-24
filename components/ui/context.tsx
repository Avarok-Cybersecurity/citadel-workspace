import {
  createContext,
  FC,
  useContext,
  useReducer,
  useMemo,
  ReactNode,
} from 'react';

export interface StateModifiers {
  setUuid: (payload: string) => void;
}

export interface StateValues {
  uuid: string;
}

const stateModifiers = {
  setUuid: (payload: string) => {},
};

const initialState = { uuid: '' };

type State = StateValues & StateModifiers;

const UIContext = createContext<State>({
  ...stateModifiers,
  ...initialState,
});

type Action = { type: 'UUID'; payload: string };

function uiReducer(state: StateValues, action: Action) {
  switch (action.type) {
    case 'UUID': {
      return {
        ...state,
        uuid: action.payload,
      };
    }
  }
}

export const UIProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(uiReducer, initialState);

  const setUuid = (payload: string) =>
    dispatch({
      type: 'UUID',
      payload,
    });

  const value = useMemo(() => {
    return {
      ...state,
      setUuid,
    };
  }, [state.uuid]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

export const useUI = () => {
  const context = useContext(UIContext);
  return context;
};
