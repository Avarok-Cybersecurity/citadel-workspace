import {
  createContext,
  FC,
  useContext,
  useReducer,
  useMemo,
  ReactNode,
} from 'react';

export interface StateModifiers {
  sidebar: (payload: boolean) => void;
}

export interface StateValues {
  isSidebarOpen: boolean;
}

const stateModifiers = {
  sidebar: (payload: boolean) => {},
};

const initialState = { isSidebarOpen: true };

type State = StateValues & StateModifiers;

const UIContext = createContext<State>({
  ...stateModifiers,
  ...initialState,
});

type Action = { type: 'SIDEBAR'; payload: boolean };

function uiReducer(state: StateValues, action: Action) {
  switch (action.type) {
    case 'SIDEBAR': {
      return {
        ...state,
        isSidebarOpen: action.payload,
      };
    }
  }
}

export const UIProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(uiReducer, initialState);

  const sidebar = (payload: boolean) =>
    dispatch({
      type: 'SIDEBAR',
      payload,
    });

  const value = useMemo(() => {
    return {
      ...state,
      sidebar,
    };
  }, [state.isSidebarOpen]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

export const useUI = () => {
  const context = useContext(UIContext);
  return context;
};
