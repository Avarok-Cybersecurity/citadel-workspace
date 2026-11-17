#!/usr/bin/env node
/**
 * A person is drawn by `MemberAvatar`, nowhere else.
 *
 * `MemberAvatar` asks `useAvatarUrl` for the picture and draws initials only when there is none.
 * Eighteen views drew their own circle instead: an `<Avatar>` with an `<AvatarFallback>` and no
 * image, or a bare coloured `<div>` holding a letter. The same person then had a photo in the
 * sidebar and a grey "A" in the notification, the account list, the call card and the group
 * dialogs. Four of them also drew the presence dot inside the avatar's `overflow-hidden` clip, so
 * half of it was cut away.
 *
 * Forbidden outside the allowlist: the `<Avatar` / `<AvatarFallback` / `<AvatarImage` primitives.
 * A place that is not a person (a workspace icon, a placeholder glyph) says so in ALLOWED.
 *
 * Node 18-compatible on purpose: the lint jobs run the oldest supported Node.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';

/** Each entry is a file allowed to use the primitives, with why it is not drawing a person. */
const ALLOWED = new Map([
  ['src/components/ui/avatar.tsx', 'defines the primitives'],
  ['src/components/shared/MemberAvatar.tsx', 'is the one component that draws a person'],
  ['src/components/layout/sidebar/TopBar.tsx', 'the signed-in user\'s own menu button: picture from currentUser, wrapped in the admin and status ring'],
  ['src/pages/UserProfileCard.tsx', 'the empty state draws a generic user glyph, not a person'],
]);

const PRIMITIVE = /<Avatar(?:Fallback|Image)?[\s>]/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      out.push(...walk(p));
    } else if (/\.tsx$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

const offences = [];
for (const file of walk(ROOT)) {
  const rel = file.split('\\').join('/');
  if (ALLOWED.has(rel)) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const text = line.trimStart();
    if (text.startsWith('*') || text.startsWith('//') || text.startsWith('{/*')) return;
    if (PRIMITIVE.test(line)) offences.push({ file: rel, line: i + 1 });
  });
}

if (offences.length > 0) {
  for (const o of offences) {
    console.error(`::error file=citadel-workspaces/${o.file},line=${o.line}::draws an avatar with the primitives; use <MemberAvatar username name /> so the picture is not dropped (see src/components/shared/MemberAvatar.tsx). If this is not a person, add the file to ALLOWED with the reason.`);
  }
  process.exit(1);
}
console.log('  Avatars: every person is drawn by MemberAvatar  ok');
