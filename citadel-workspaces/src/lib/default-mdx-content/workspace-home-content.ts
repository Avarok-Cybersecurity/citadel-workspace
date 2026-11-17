/**
 * The workspace home: what this workspace is and where to go in it.
 *
 * It used to be the "MDX Editor Showcase", a Markdown tutorial that told a person
 * nothing about the workspace they had just joined. The home is not a stored
 * document (see WorkspaceView), so it is generated from what the workspace does
 * store: its name, its description and its top-level spaces.
 */

export interface HomeSpace {
  name: string;
  description: string;
}

/** Names are typed by people, and MDX runs `{…}` and `<…>` as code. */
function mdxText(text: string): string {
  return text.replace(/[\\`*_{}[\]<>#|!]/g, '\\$&');
}

function spaceLine(space: HomeSpace): string {
  const description: string = space.description.trim();
  return `- **${mdxText(space.name)}**${description ? ` — ${mdxText(description)}` : ''}`;
}

export function getWorkspaceHomeContent(workspaceName: string, description: string, spaces: readonly HomeSpace[]): string {
  const intro: string = description.trim() ? `${mdxText(description.trim())}\n\n` : '';
  const listing: string = spaces.length > 0
    ? `## Offices\n\n${spaces.map(spaceLine).join('\n')}\n\nOpen one from the sidebar to read its page, chat in its channel, or join a call there.`
    : '## No offices yet\n\nAn administrator adds the first one with the + beside the workspace in the sidebar. Until then, direct messages, groups and files all work from the sidebar.';
  return `# ${mdxText(workspaceName)}

${intro}Everything here is end-to-end encrypted with post-quantum cryptography, and messages travel directly between people rather than through a server.

${listing}
`;
}
