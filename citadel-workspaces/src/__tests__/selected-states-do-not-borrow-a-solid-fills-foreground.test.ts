/**
 * A `-foreground` token belongs to ONE fill, and only to that fill.
 *
 * `--primary-foreground` is WHITE in both themes, and index.css says why in as
 * many words: "--primary is the button FILL, so it must carry white text at
 * AA". It is correct on `bg-primary` and nowhere else. Put it on `bg-primary/10`
 * and the fill composites towards the page while the text stays white — which
 * is what a user reported on the Theme picker's selected button, label and sun
 * icon both, at 1.17:1 against the settings dialog.
 *
 * Dark mode hides every instance of it, because there the page text is already
 * near-white and lands on its feet by accident. That asymmetry is why each case
 * below is measured in BOTH themes, and it is why the identical fix landed once
 * in TreeNodeItem and was never carried to the six other sites that had it.
 *
 * Split out of light-mode-has-no-invisible-controls rather than appended to it:
 * that file guards raw palette values surviving the token migration, which is a
 * different question, and the pair would have run past 250 lines together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/test-utils/strip-comments';
import { contrastRatio } from '@/lib/theme/hsl';
import {
  AA_NON_TEXT, AA_TEXT, readThemeTokens, tintedContrast, token,
} from '@/test-utils/token-contrast';

/** Comments are stripped: they necessarily quote the class each fix replaced. */
const src: (p: string) => string = (p: string): string => stripComments(readFileSync(join(process.cwd(), 'src', p), 'utf8'));

/**
 * The `-foreground` tokens are pair colours, not general text colours.
 *
 * `--primary-foreground` is WHITE in both themes, and index.css says why in as
 * many words: "--primary is the button FILL, so it must carry white text at AA".
 * It is correct on `bg-primary` and nowhere else. Put it on `bg-primary/10` and
 * the fill composites to near-white while the text stays white — which is what
 * a user reported on the Theme picker's selected button, label and sun icon
 * both, at 1.17:1 against the settings dialog.
 *
 * Dark mode hides every instance of this, because there the page text is
 * already near-white and lands on its feet by accident. That asymmetry is why
 * these are measured in BOTH themes below, and why the identical fix landed
 * once in TreeNodeItem and was never carried to the five other sites.
 *
 * The class strings are read out of the components rather than restated, so
 * these numbers describe what ships. Reverting a fix does not fail a string
 * comparison here — it changes the measured ratio, and the failure says so.
 */
describe('a tinted fill does not wear the solid fill\'s foreground', () => {
  interface Site {
    readonly name: string;
    readonly file: string;
    /** Captures fill token, alpha percent, text token from the real source. */
    readonly pattern: RegExp;
    /** The surface the tint composites over, per the component's container. */
    readonly backdrop: string;
  }

  // Backdrops: the settings and entity dialogs are DialogContent, which is
  // `bg-background`; the offline strip is fixed over the page; the file list
  // and grid items are `bg-card`.
  const SITES: readonly Site[] = [
    { name: 'Theme picker, selected option', file: 'components/settings/ThemeSelector.tsx',
      pattern: /border-primary bg-([\w-]+)\/(\d+) text-([\w-]+)'/, backdrop: 'background' },
    { name: 'Offline banner', file: 'components/pwa/OfflineBanner.tsx',
      pattern: /'bg-([\w-]+)\/(\d+) text-([\w-]+) border-b/, backdrop: 'background' },
    // The file list and grid, which replaced the VFS tree: both sit on `bg-card`.
    { name: 'File list, selected row', file: 'components/file-manager/VFSListRow.tsx',
      pattern: /isSelected && 'bg-([\w-]+)\/(\d+) text-([\w-]+)/, backdrop: 'card' },
    { name: 'File grid, selected tile', file: 'components/file-manager/VFSGridItem.tsx',
      pattern: /isSelected && 'bg-([\w-]+)\/(\d+) text-([\w-]+)/, backdrop: 'card' },
    // The entity modal submit used to be listed here: it was a 20% tint whose hover had to be
    // checked. It is now the solid primary fill (EntityModalFooter), which carries its own
    // foreground, so there is no tint left to check (owner, 2026-09-27: it looked disabled).
  ];

  for (const site of SITES) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${site.name} is readable in ${theme} mode`, () => {
        const match: RegExpMatchArray | null = src(site.file).match(site.pattern);
        // Without this the destructure below would throw on a rename and the
        // reason would be a TypeError rather than "this site moved".
        expect(match, `no tinted selected state found in ${site.file}`).not.toBeNull();
        const [, fill, alpha, text] = match as RegExpMatchArray;

        const tokens: ReturnType<typeof readThemeTokens> = readThemeTokens(theme);
        const ratio: number = tintedContrast(tokens, fill, Number(alpha), site.backdrop, text);
        expect(
          ratio,
          `text-${text} on bg-${fill}/${alpha} over --${site.backdrop} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }
});

/**
 * The mirror of the same mistake, and the reason this suite checks dark too.
 *
 * The video-quality radio marks its choice with a white tick on a solid fill.
 * On `--primary-accent` that pairing is only accidentally right: the token is
 * DARK in light mode but LIGHT in dark mode, so the tick measured 2.86:1 there
 * — under the 3:1 WCAG 1.4.11 asks of a non-text indicator. `--primary` is the
 * token `--primary-foreground` is actually defined against, and it is dark in
 * both themes.
 */
describe('the selected-quality tick sits on the fill its colour is paired with', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`clears the non-text minimum in ${theme} mode`, () => {
      const source: string = src('components/call/VideoSettingsModal.tsx');
      const fill: RegExpMatchArray | null = source.match(/selected \? 'border-[\w-]+ bg-([\w-]+)'/);
      expect(fill, 'the selected radio dot moved').not.toBeNull();
      // The tick inherits nothing: it names its own colour, and that is the
      // colour that has to clear the fill.
      const tick: RegExpMatchArray | null = source.match(/<Check className="[^"]*text-([\w-]+)"/);
      expect(tick, 'the tick moved').not.toBeNull();

      const tokens: ReturnType<typeof readThemeTokens> = readThemeTokens(theme);
      const ratio: number = contrastRatio(token(tokens, fill![1]), token(tokens, tick![1]));
      expect(ratio, `text-${tick![1]} on bg-${fill![1]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });
  }
});

/**
 * The propagation guard, so the next one is caught where it is written.
 *
 * The five sites above were found by grepping for the mechanism after one of
 * them was reported. A fix applied at the reported site only is how this bug
 * survived its first correction, so what is asserted here is the RULE — any
 * `-foreground` token painted on any tinted fill, anywhere in the tree — rather
 * than the five files that happened to break it.
 *
 * Composited over `--background`. The app's surfaces sit within a few points of
 * it (card 99%, surface 96%, popover 100% in light), and a class string cannot
 * say which one it will land on; a wrong-by-a-token backdrop moves these ratios
 * by fractions, while the bug this catches moves them by an order of magnitude.
 * Class strings with no `bg-` of their own are skipped: they inherit a fill this
 * cannot see, which is why the tick above is measured by hand.
 */
describe('no `-foreground` token is painted on a tinted fill', () => {
  /** `data-[state=active]:bg-primary/10` -> variant `data-[state=active]:`, utility `bg-primary/10`. */
  const UTILITY: RegExp = /^(.*:)?((?:bg|text)-[a-z][\w-]*(?:\/\d{1,3})?)$/;
  const TINT: RegExp = /^bg-([a-z][\w-]*)\/(\d{1,3})$/;
  const SOLID: RegExp = /^bg-([a-z][\w-]*)$/;
  /** Deliberately not `text-foreground`: that is the general text token, and it
      is the correct answer here. Only the PAIR tokens are misused this way. */
  const PAIR_TEXT: RegExp = /^text-([a-z][\w-]*-foreground)$/;

  interface Finding { readonly file: string; readonly fill: string; readonly alpha: number; readonly text: string }

  /**
   * Fills and texts pair only within the same variant. `data-[state=active]:
   * bg-primary-accent/30 data-[state=active]:text-primary-accent text-muted-
   * foreground` is three classes in two scopes: the tint never coexists with
   * the muted text, and reading the line as one bag of classes reported a
   * contrast no user can be shown.
   */
  function scan(line: string, file: string): Finding[] {
    const byVariant: Map<string, { fill?: [string, number]; solid?: boolean; text?: string }> = new Map<string, { fill?: [string, number]; solid?: boolean; text?: string }>();
    for (const raw of line.split(/[\s"'`{}(),]+/)) {
      const utility: RegExpMatchArray | null = UTILITY.exec(raw);
      if (!utility) continue;
      const scope: string = utility[1] ?? '';
      const entry: { fill?: [string, number]; solid?: boolean; text?: string } = byVariant.get(scope) ?? {};
      const tint: RegExpMatchArray | null = TINT.exec(utility[2]);
      const solid: RegExpMatchArray | null = SOLID.exec(utility[2]);
      const text: RegExpMatchArray | null = PAIR_TEXT.exec(utility[2]);
      if (tint) entry.fill = [tint[1], Number(tint[2])];
      if (solid) entry.solid = true;
      if (text) entry.text = text[1];
      byVariant.set(scope, entry);
    }
    const out: Finding[] = [];
    for (const [, e] of byVariant) {
      // A solid fill in the same scope is exactly what these tokens are FOR.
      if (e.fill && e.text && !e.solid) out.push({ file, fill: e.fill[0], alpha: e.fill[1], text: e.text });
    }
    return out;
  }

  const findings: Finding[] = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full: string = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      for (const line of stripComments(readFileSync(full, 'utf8')).split('\n')) {
        findings.push(...scan(line, full));
      }
    }
  };
  walk(join(process.cwd(), 'src'));

  it('the scan sees the pattern it is looking for, and only it', () => {
    // Waiting for absence passes instantly. If a refactor moved these utilities
    // out from under the regexes there would be nothing left to measure and
    // every assertion below would be vacuously true, so the detector is shown
    // to discriminate — in both directions — before its silence is trusted.
    expect(scan('isActive && "bg-primary/10 text-primary-foreground"', 'f')).toHaveLength(1);
    expect(scan('className="bg-primary text-primary-foreground"', 'f'), 'a solid fill is the correct pairing').toHaveLength(0);
    expect(scan('className="bg-primary/10 text-foreground"', 'f'), 'the general text token is the fix, not the bug').toHaveLength(0);
    expect(
      scan('className="data-[state=active]:bg-primary-accent/30 data-[state=active]:text-primary-accent text-muted-foreground"', 'f'),
      'a tint in one variant must not pair with text in another',
    ).toHaveLength(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`every such pairing that ships clears AA in ${theme} mode`, () => {
      const tokens: ReturnType<typeof readThemeTokens> = readThemeTokens(theme);
      const failures: string[] = findings.flatMap((f): string[] => {
        const ratio: number = tintedContrast(tokens, f.fill, f.alpha, 'background', f.text);
        return ratio >= AA_TEXT
          ? []
          : [`${f.file}: text-${f.text} on bg-${f.fill}/${f.alpha} is ${ratio.toFixed(2)}:1`];
      });
      expect(failures, failures.join('\n')).toHaveLength(0);
    });
  }
});
