/**
 * Where the ribbons find the editor. The editor wiring provides its EditorController here
 * (`<EditorControllerContext.Provider value={controller}>`); until it does there is no ribbon. The ribbons need only this slice of the
 * controller, so nothing about collaboration or hit-testing reaches them.
 */
import { createContext, useCallback, useContext, useSyncExternalStore, type Context } from 'react';
import type { EditorController, EditorState } from '@/lib/cdoc/editor/controller';

export type RibbonEditor = Pick<EditorController, 'state' | 'execute' | 'addImage' | 'selectionText' | 'styles' | 'focus' | 'on'>;

export const EditorControllerContext: Context<RibbonEditor | null> = createContext<RibbonEditor | null>(null);

export function useEditorController(): RibbonEditor | null {
  return useContext(EditorControllerContext);
}

const NO_SUBSCRIPTION: () => void = (): void => undefined;

/** The editor's state, re-read on every `selection` event; null with no editor. */
export function useEditorState(editor: RibbonEditor | null): EditorState | null {
  const subscribe: (onChange: () => void) => () => void = useCallback(
    (onChange: () => void): (() => void) => (editor === null ? NO_SUBSCRIPTION : editor.on('selection', onChange)),
    [editor],
  );
  return useSyncExternalStore(subscribe, (): EditorState | null => editor?.state ?? null);
}
