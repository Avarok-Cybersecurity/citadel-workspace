/**
 * Controls that vanish in light mode — the ones a linter cannot see.
 *
 * ESLint's `no-restricted-syntax` covers Tailwind palette classes across the
 * whole source tree. It deliberately does NOT cover `ring-white` /
 * `border-white` (the colour picker needs those against arbitrary user-chosen
 * hues), and it cannot read CSS files at all. Those two gaps are what this
 * file guards.
 *
 *
 * The token architecture here is good and light mode is real end to end — which
 * is exactly why the stragglers matter: a handful of raw palette values from
 * before the token migration still ship, and each one was picked to look right
 * on a dark surface. On the light theme they land on their own colour.
 *
 * Asserted against the source, because these are CSS facts with no runtime
 * behaviour to observe: jsdom applies no stylesheet and computes no contrast.
 * The test is a guard against reintroduction, and it names each site so a
 * failure says which one came back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/test-utils/strip-comments';

/**
 * Comments are stripped before matching. The first version of this test failed
 * against its own fix, because the comments explaining what each raw value was
 * replaced WITH necessarily quote the value it was replaced FROM. Asserting on
 * prose rather than code is how a guard starts reporting on itself.
 */
const src = (p: string): string => stripComments(readFileSync(join(process.cwd(), 'src', p), 'utf8'));

describe('selection and loading indicators use theme tokens', () => {
  it('the role-colour ring is not white on a white background', () => {
    // The swatches moved to RoleColorPicker when GroupRoleEditor was split.
    // The second assertion is what makes that safe: pointing at a file with no
    // ring in it would satisfy the `not.toMatch` and check nothing.
    const source: string = src('components/chat/RoleColorPicker.tsx');
    // `ring-offset-background` is white in light mode, so `ring-white` offset
    // against it is a white ring on white — the selected swatch loses its only
    // indicator.
    expect(source).not.toMatch(/ring-offset-background[^'"`]*ring-white/);
    expect(source).toMatch(/ring-offset-background[^'"`]*ring-ring/);
  });

  it('the workspace switcher spinner is not white on a near-white surface', () => {
    const source: string = src('components/layout/sidebar/WorkspaceSwitcher.tsx');
    expect(source).not.toContain('border-white');
    expect(source).toContain('Loader2');
  });

  it('the pending-requests badge uses the destructive variant', () => {
    // The raw-palette half of this is ESLint's job now — `no-restricted-syntax`
    // covers every Tailwind palette class across the whole tree, and the
    // eight-entry exemption list that used to let this file through is gone.
    // What ESLint cannot check is that the replacement is the RIGHT token, so
    // that is what this asserts.
    // The badge moved to its own component when MembersSection was split; the
    // paired positive assertion below is what stops this pointing at a file
    // with no badge in it and passing for ever.
    const source: string = src('components/layout/sidebar/PendingRequestsBadge.tsx');
    expect(source).toMatch(/variant="destructive"/);
    expect(source, 'this file must actually render the badge').toMatch(/<Badge/);
  });
});

describe('the collaborative editor context menu follows the theme', () => {
  const css: string = stripComments(readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8'));
  const block: string = css.slice(
    css.indexOf('.editor-context-menu {'),
    css.indexOf('@keyframes context-menu-in') === -1
      ? css.indexOf('.editor-context-menu {') + 1200
      : css.indexOf('@keyframes context-menu-in'),
  );

  it('was found, so the assertions below are about something', () => {
    // Without this the slice could be empty and every "does not contain" below
    // would pass on nothing.
    expect(block).toContain('.editor-context-menu');
    expect(block.length).toBeGreaterThan(100);
  });

  it('uses no pre-migration hex values', () => {
    for (const hex of ['#1a1b26', '#3a3f5c', '#e5e7eb', '#6E59A5']) {
      expect(block).not.toContain(hex);
    }
  });

  it('paints from the popover and primary tokens', () => {
    expect(block).toContain('hsl(var(--popover))');
    expect(block).toContain('hsl(var(--border))');
    expect(block).toContain('hsl(var(--primary))');
  });
});

/**
 * Text fields draw their edge with `--control-border` (3:1 on every surface, both modes).
 *
 * Live (owner, 2026-09-27): the chat composer had no visible border in light mode. The primitives
 * used `border-input` (~1.08:1 on white) and call sites overrode even that with
 * `border-surface/50`, `border-surface` or `border-border`. An override of a field's border
 * colour is what hides the edge, so none is allowed; a field that needs emphasis uses focus.
 */
describe('text fields keep a visible edge', () => {
  const PRIMITIVES: readonly string[] = ['components/ui/input.tsx', 'components/ui/textarea.tsx', 'components/ui/select.tsx'];

  it('the Input, Textarea and Select primitives rest on the control border', () => {
    for (const file of PRIMITIVES) {
      const source: string = src(file);
      expect(source, file).toContain('border-control-border');
      expect(source, file).not.toMatch(/\bborder-input\b/);
    }
  });

  it('no call site overrides a field border with a faint colour', () => {
    const root: string = join(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full: string = join(dir, name);
        if (name === '__tests__' || name === 'node_modules') continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.tsx')) files.push(full);
      }
    };
    walk(join(root, 'components'));
    walk(join(root, 'pages'));
    const FIELD_WITH_FAINT_BORDER: RegExp = /<(?:Input|Textarea|SelectTrigger)\b[^>]*?className=(?:"|\{`|\{cn\()[^>]*?\bborder-(?:surface|border|input|transparent)(?:\/\d+)?\b/gs;
    const offenders: string[] = [];
    for (const file of files) {
      const source: string = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(FIELD_WITH_FAINT_BORDER)) {
        offenders.push(`${file.slice(root.length + 1)}: ${match[0].slice(0, 90).replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
