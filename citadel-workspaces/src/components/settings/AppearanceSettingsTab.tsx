import { useState, useEffect } from 'react';
import { Monitor, Type, Layout } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ThemeSelector } from './ThemeSelector';
import { WorkspaceAppearanceSection } from './WorkspaceAppearanceSection';
import {
  type AppearanceSettings,
  loadAppearanceSettings,
  saveAppearanceSettings,
} from '@/lib/appearance-settings';
import { ANIMATIONS_PREFERENCES, isAnimationsPreference, type AnimationsPreference } from '@/lib/motion-tier';

const ANIMATIONS_LABELS: Record<AnimationsPreference, string> = { auto: 'Auto', full: 'Full', lite: 'Lite', off: 'Off' };

/**
 * Compact Mode and Group Messages used to sit here too. Neither had any
 * consumer anywhere in the tree -- no `.compact-mode` rule existed, and the app
 * has no message grouping to switch off -- so both were switches that moved and
 * changed nothing. They are gone rather than left in place: a settings page
 * where flipping a control does nothing visible is worse than a shorter one,
 * because it teaches the user not to trust the controls that DO work.
 */

export function AppearanceSettingsTab(): JSX.Element {
  const [settings, setSettings] = useState<AppearanceSettings>(loadAppearanceSettings);

  // Persisting and applying are the same act, and both live in the module that
  // main.tsx also calls at boot -- which is what makes a choice survive a
  // reload instead of lasting only as long as this tab is mounted.
  useEffect(() => { saveAppearanceSettings(settings); }, [settings]);

  const update = <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]): void => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      <ThemeSelector />

      {/* The workspace's colours sit beside the personal light/dark choice: this
          is the one place a user asks "how does this look", and the adjacency
          makes the split legible. */}
      <WorkspaceAppearanceSection />

      {/* Display Density */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Layout className="h-4 w-4 text-primary-accent" />
          Display
        </div>

        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
          <div className="min-w-0">
            <Label htmlFor="show-avatars" className="text-sm font-medium">Show Avatars</Label>
            <p className="text-xs text-muted-foreground">Display user avatars in messages and lists</p>
          </div>
          <Switch id="show-avatars"
            checked={settings.showAvatars}
            onCheckedChange={(v) => update('showAvatars', v)}
          />
        </div>
      </div>

      {/* Typography */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Type className="h-4 w-4 text-primary-accent" />
          Typography
        </div>

        <div className="p-3 rounded-lg bg-background/50 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="font-size" className="text-sm font-medium">Font Size</Label>
            <span className="text-xs text-muted-foreground">{settings.fontSize}px</span>
          </div>
          <Slider id="font-size"
            label="Font size in pixels"
            value={[settings.fontSize]}
            onValueChange={([v]) => update('fontSize', v)}
            min={12}
            max={18}
            step={1}
            className="w-full"
          />
        </div>
      </div>

      {/* Sidebar */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Monitor className="h-4 w-4 text-primary-accent" />
          Layout
        </div>

        <div className="p-3 rounded-lg bg-background/50">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="sidebar-width" className="text-sm font-medium">Sidebar Width</Label>
              <p className="text-xs text-muted-foreground">Adjust the navigation sidebar width</p>
            </div>
            <Select
              value={settings.sidebarWidth}
              onValueChange={(v) => update('sidebarWidth', v as AppearanceSettings['sidebarWidth'])}
            >
              <SelectTrigger id="sidebar-width" className="w-28 h-8 bg-surface text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="narrow">Narrow</SelectItem>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="wide">Wide</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
          <div className="min-w-0">
            <Label htmlFor="animations" className="text-sm font-medium">Animations</Label>
            <p className="text-xs text-muted-foreground">Auto uses lighter motion on slower devices</p>
          </div>
          <Select value={settings.animations} onValueChange={(v) => { if (isAnimationsPreference(v)) update('animations', v); }}>
            <SelectTrigger id="animations" className="w-28 h-8 bg-surface text-sm" data-testid="appearance-animations">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANIMATIONS_PREFERENCES.map((p: AnimationsPreference) => <SelectItem key={p} value={p}>{ANIMATIONS_LABELS[p]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
