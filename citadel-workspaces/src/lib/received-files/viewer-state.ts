/**
 * Where the picture viewer is: which picture of how many, and at what zoom. Pure; the keys a
 * viewer answers are decided here too, so the dialog and its tests read one table.
 */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 1, 1.5, 2, 3, 4];

export interface ViewerState {
  readonly index: number;
  /** null fits the picture to the screen; otherwise a scale of its natural size. */
  readonly zoom: number | null;
}

export type ViewerAction = 'previous' | 'next' | 'zoom-in' | 'zoom-out' | 'fit';

export function step(state: ViewerState, action: ViewerAction, count: number): ViewerState {
  switch (action) {
    case 'previous': return state.index > 0 ? { index: state.index - 1, zoom: null } : state;
    case 'next': return state.index < count - 1 ? { index: state.index + 1, zoom: null } : state;
    case 'fit': return { ...state, zoom: null };
    case 'zoom-in': {
      const next: number | undefined = state.zoom === null ? 1 : ZOOM_STEPS.find((z: number): boolean => z > (state.zoom ?? 0));
      return { ...state, zoom: next ?? state.zoom };
    }
    case 'zoom-out': {
      if (state.zoom === null) return state;
      const lower: number[] = ZOOM_STEPS.filter((z: number): boolean => z < (state.zoom ?? 0));
      return lower.length > 0 ? { ...state, zoom: lower[lower.length - 1] } : state;
    }
  }
}

const KEYS: Readonly<Record<string, ViewerAction>> = {
  ArrowLeft: 'previous', ArrowRight: 'next', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'fit',
};

export function actionForKey(key: string): ViewerAction | null {
  return KEYS[key] ?? null;
}
