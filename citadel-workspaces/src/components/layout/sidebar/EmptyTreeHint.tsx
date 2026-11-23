/**
 * What the hierarchy says when it holds no spaces: that the load failed, or
 * that the workspace is empty -- advice matched to whether this reader may add.
 */
interface EmptyTreeHintProps {
  /** The node list's deadline expired without an answer: nothing is known to be empty. */
  unavailable: boolean;
  /** Null when this reader may create; see AddNodeButton. */
  createBlockedReason: string | null;
}

export function EmptyTreeHint({ unavailable, createBlockedReason }: EmptyTreeHintProps): JSX.Element {
  return (
    <div className="px-3 py-2 text-sm text-muted-foreground">
      {unavailable ? (
        <span data-testid="tree-unavailable">
          Your spaces could not be loaded. Nothing has been deleted — reload, or open
          another workspace and come back, to try again.
        </span>
      ) : (
        <span data-testid="tree-empty">
          {createBlockedReason === null
            ? 'Your workspace is empty. Click the + button to create your first space.'
            : 'No spaces yet. An administrator adds the first one.'}
        </span>
      )}
    </div>
  );
}
