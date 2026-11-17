import { RELEASES_PAGE } from '@/lib/agent-download';

/** A link to the page that lists every agent download. Lives here because only agent-setup names release locations. */
export function AgentDownloadLink({ children }: { children: string }): JSX.Element {
  return (
    <a href={RELEASES_PAGE} target="_blank" rel="noopener noreferrer"
      className="text-primary-accent underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
