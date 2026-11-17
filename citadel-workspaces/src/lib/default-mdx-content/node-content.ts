/**
 * Default Node Content Templates
 *
 * The first thing anyone sees inside a new office or room.
 *
 * This used to be a Markdown syntax tutorial — bold, italics, code fences. That
 * teaches people about Markdown, which they either already know or can look up,
 * and tells them nothing about the product they have just opened. What a new
 * user actually needs is the answer to "what is this place, and what do I do
 * next", so that is what it says now.
 */

export const getDefaultNodeContent = (nodeName: string): string => `# ${nodeName}

This is a room in your workspace: a place for a team to talk, share files, and
work on documents together. Everything here is end-to-end encrypted with
post-quantum cryptography, and messages travel directly between people rather
than through a server.

Replace this page with whatever your team needs — it is a normal document and
everyone with access can edit it.

## Getting started

**Invite people.** Open the members panel from the sidebar to add someone to
this room. They will need an account on this workspace first.

**Talk.** Use the chat alongside this document for conversation. Messages are
delivered directly to each person, and anything sent while they are offline is
held and delivered when they return.

**Call.** The phone and video buttons at the top of a conversation start an
audio or video call. Your microphone and camera stay off until you turn them on,
and the other person is asked before anything connects.

**Share files.** Drag a file into the chat. It goes straight to the people in
the conversation, encrypted, without being uploaded anywhere in between.

**Write together.** Open a live document to edit at the same time as someone
else and see their changes as they type.

## Organising the workspace

Workspaces are made of **offices**, and offices contain **rooms**. Use offices
for teams or projects and rooms for the topics inside them — the same way you
would organise physical space.

Permissions follow that structure: access granted on an office applies to the
rooms inside it, so you can give someone a whole project without adding them to
every room by hand.

## Making it yours

An administrator can change the workspace's colours and icon under
**Settings → Theme**. Whatever they choose is what everyone sees, while each
person still picks light or dark for themselves.

---

*Every message, file and call in this workspace is encrypted end to end. No
server in the middle can read them — including the one hosting this workspace.*
`;

export const getDefaultChildNodeContent = (nodeName: string, nodeDescription?: string): string => `# ${nodeName}

${nodeDescription || 'A room for focused work: conversation, files, and shared documents in one place.'}

## What this page is for

This page belongs to the room and everyone with access can edit it. It works well
as the thing a newcomer reads first — what the room is for, who is in it, and
where the important links live.

Some teams keep a short brief here. Others keep decisions, or a list of the
documents that matter. Delete this and write what your team actually needs.

## Alongside this page

**Chat** runs beside the document, so discussion stays next to the work rather
than in a separate app.

**Calls** start from the phone or video button at the top of a conversation, for
when writing is slower than talking.

**Files** dropped into the chat go directly to the people in the room, encrypted,
without passing through storage in between.

**Live documents** let several people type at once and see each other's changes
as they happen.

---

*This room inherits access from the office above it, so anyone who can reach that
office can reach this room.*
`;
