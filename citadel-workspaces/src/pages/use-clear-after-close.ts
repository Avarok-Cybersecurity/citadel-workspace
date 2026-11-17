import { useEffect, useRef } from 'react';

/**
 * Run `clear` once a flow a link started has opened and then closed.
 *
 * A deep link's parameters stay in the URL while the flow they started is
 * showing, so a reload (the new-version banner's, or the user's) lands back in
 * that flow instead of on a bare landing page. They are cleared once it closes,
 * so a later reload, or back/forward, does not replay a link already dealt with.
 *
 * `pending` is true from the moment the link was acted on; `open` is whether its
 * flow is showing. The flow opens asynchronously (the agent gate), so a `pending`
 * link that has not opened yet is not cleared.
 */
export function useClearAfterClose(pending: boolean, open: boolean, clear: () => void): void {
  const sawOpen: React.MutableRefObject<boolean> = useRef<boolean>(false);
  useEffect(() => {
    if (!pending) {
      sawOpen.current = false;
      return;
    }
    if (open) {
      sawOpen.current = true;
      return;
    }
    if (sawOpen.current) {
      sawOpen.current = false;
      clear();
    }
  }, [pending, open, clear]);
}
