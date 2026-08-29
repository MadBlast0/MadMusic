import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useTheme } from 'next-themes';

import { toast } from 'sonner';

import {
  Check,
  Contrast,
  Disc,
  Download,
  Folder,
  FolderOpen,
  Globe,
  Info,
  Keyboard,
  Library,
  Monitor,
  Moon,
  Palette,
  Refresh,
  Shield,
  Sliders,
  Sun,
  Users,
} from '@/components/icons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FolderManager } from '@/components/library/folder-manager';
import { ImportPreview } from '@/components/common/import-preview';
import { isNative } from '@/lib/native';
import { useAccount } from '@/components/auth/auth-context';
import { useEssence } from '@/components/common/theme-context';
import { useOffline } from '@/components/common/offline-context';
import { useSaved } from '@/components/common/saved-context';
import { useSettings } from '@/components/common/settings-context';
import { useLibrary } from '@/components/library/library-context';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { authInstance } from '@/lib/auth-config';
import { exportToFile, importFromFile } from '@/lib/backup';
import { isDesktop } from '@/lib/desktop';
import { formatBytes } from '@/lib/offline';
import * as lastfm from '@/lib/scrobble';
import { DEFAULT_ACCENT, ESSENCES, type Essence } from '@/lib/theme';
import type { Density, Quality, StartupView } from '@/lib/settings';
import type { PagingMode } from '@/lib/paging';
import {
  choiceFor,
  DENSITY_VIEWS,
  setChoice,
  type DensityChoice,
} from '@/lib/density';
import { cn } from '@/lib/utils';
import { ExtractorStatus } from '@/components/common/extractor-status';
import { LovedSync } from '@/components/common/loved-sync';
import { TabStrip } from '@/components/common/tab-strip';
import { ViewShell, ViewTitle } from '@/views/view-shell';
import { useSidebarLayout } from '@/components/common/sidebar-context';
import { Grip } from '@/components/icons';
import { backendAvailable } from '@/lib/convex-client';
import { BAR_EXCLUDES, SIDEBAR_ITEMS, move, toggleHidden } from '@/lib/sidebar';
/**
 * The eight panels that live in `settings-extra`.
 *
 * Lazy, because they are 1,676 lines that no default view of this screen
 * renders. `settings-view` is already a lazy route, but that only defers the
 * whole screen — opening Settings still parsed both files, and the categories
 * most people never visit are the larger half of that.
 *
 * They resolve to one shared chunk rather than eight, since they come from one
 * module. That is the right granularity: whichever category is clicked first
 * pays for it, and the rest are then free.
 */
const AccessibilitySettings = lazy(() =>
  import('@/views/settings-extra').then((m) => ({
    default: m.AccessibilitySettings,
  })),
);
const AudioSettingsSection = lazy(() =>
  import('@/views/settings-extra').then((m) => ({
    default: m.AudioSettingsSection,
  })),
);
const LibraryToolsSettings = lazy(() =>
  import('@/views/settings-extra').then((m) => ({
    default: m.LibraryToolsSettings,
  })),
);
const OfflineSettings = lazy(() =>
  import('@/views/settings-extra').then((m) => ({
    default: m.OfflineSettings,
  })),
);
const PeopleSettings = lazy(() =>
  import('@/views/settings-extra').then((m) => ({ default: m.PeopleSettings })),
);
const ProfileSettings = lazy(() =>
  import('@/views/settings-extra').then((m) => ({
    default: m.ProfileSettings,
  })),
);
const ShortcutSettings = lazy(() =>
  import('@/views/settings-extra').then((m) => ({
    default: m.ShortcutSettings,
  })),
);
const UpdateSettings = lazy(() =>
  import('@/views/settings-extra').then((m) => ({ default: m.UpdateSettings })),
);

/**
 * Preferences, split into categories along the top.
 *
 * One long scroll works up to about a dozen settings and then stops working:
 * everything below the fold is undiscoverable, and related controls end up
 * separated by whatever happened to be declared between them. Categories give
 * each group a name and keep any one screen short enough to read.
 *
 * Controls whose behaviour lives in the Rust audio pipeline are marked
 * `pending` rather than hidden. The pipeline is designed
 * (`docs/music-sources.md`) but not built, and a switch that silently does
 * nothing is worse than one that says so.
 */
type Category =
  | 'account'
  | 'appearance'
  | 'playback'
  | 'audio'
  | 'catalogue'
  | 'library'
  | 'offline'
  | 'general'
  | 'keyboard'
  | 'people'
  | 'profiles'
  | 'accessibility'
  | 'privacy'
  | 'updates'
  | 'about';

/**
 * The categories, in the order somebody looks for them.
 *
 * Appearance and Playback first because they are what people change; About
 * last because it is what they read once. Accessibility sits in the middle
 * rather than at the end, deliberately — putting it last is how it becomes the
 * section nobody finds.
 */
const CATEGORIES: { id: Category; label: string; icon: typeof Palette }[] = [
  { id: 'account', label: 'Account', icon: Users },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'accessibility', label: 'Accessibility', icon: Contrast },
  { id: 'playback', label: 'Playback', icon: Sliders },
  { id: 'audio', label: 'Audio', icon: Disc },
  { id: 'catalogue', label: 'Catalogue', icon: Globe },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'offline', label: 'Offline', icon: Download },
  { id: 'people', label: 'People', icon: Users },
  { id: 'profiles', label: 'Profiles', icon: Users },
  { id: 'general', label: 'General', icon: Monitor },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'updates', label: 'Updates', icon: Refresh },
  { id: 'about', label: 'About', icon: Info },
];

export function SettingsView({ onOpenLegal }: { onOpenLegal: () => void }) {
  const [category, setCategory] = useState<Category>('appearance');
  const { reset } = useSettings();

  return (
    <ViewShell
      header={
        <div className="flex flex-col gap-4">
          <ViewTitle
            title="Settings"
            action={
              <Button variant="ghost" size="sm" onClick={reset}>
                Reset to defaults
              </Button>
            }
          />
          {/*
            The shared strip rather than a hand-rolled row, which is what this
            was. Fifteen categories all in the tab order meant fifteen presses
            of Tab between the heading and the settings — and the arrow keys,
            which is how a tab list is supposed to be navigated, did nothing.
            An automated audit caught it; nobody had noticed by looking.
          */}
          <TabStrip
            tabs={CATEGORIES}
            value={category}
            onChange={setCategory}
            label="Settings categories"
            className="pb-1"
          />
        </div>
      }
    >
      <div className="max-w-3xl">
        {/*
          One boundary around every panel rather than one each. The lazy
          sections all resolve from the same chunk, so only the first category
          somebody opens ever suspends.

          `null` rather than a skeleton: the chunk is local and resolves within
          a frame or two, and a placeholder that flashes for 16ms reads as a
          glitch rather than as loading.
        */}
        <Suspense fallback={null}>
          {category === 'account' && <AccountSettings />}
          {category === 'appearance' && (
            <>
              <Appearance />
              <SidebarSettings />
            </>
          )}
          {category === 'accessibility' && <AccessibilitySettings />}
          {category === 'playback' && <Playback />}
          {category === 'audio' && <AudioSettingsSection />}
          {category === 'catalogue' && (
            <>
              {/* First, because "does full-length playback work" outranks every
                preference below it: a wrong answer there is music that stops
                after a minute. */}
              <ExtractorStatus />
              <Catalogue />
            </>
          )}
          {category === 'library' && (
            <>
              <LibrarySettings />
              <LibraryToolsSettings />
            </>
          )}
          {category === 'offline' && <OfflineSettings />}
          {category === 'people' && <PeopleSettings />}
          {category === 'profiles' && <ProfileSettings />}
          {category === 'general' && <General />}
          {/* The old keyboard section listed the fixed shortcuts and could not
            change them. `ShortcutSettings` replaces it with one that can, and
            keeps the reference list underneath. */}
          {category === 'keyboard' && (
            <>
              <ShortcutSettings />
              <Shortcuts />
            </>
          )}
          {category === 'privacy' && <Privacy />}
          {category === 'updates' && <UpdateSettings />}
          {category === 'about' && <About onOpenLegal={onOpenLegal} />}
        </Suspense>
      </div>
    </ViewShell>
  );
}

/* ═════════════════════════ building blocks ═════════════════════════ */

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-9">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {description && (
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      )}
      <div className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

/** One labelled row. `pending` marks a control with no behaviour behind it. */
function Row({
  label,
  hint,
  pending = false,
  control,
}: {
  label: string;
  hint?: string;
  pending?: boolean;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          {pending && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Not wired yet
            </span>
          )}
        </div>
        {hint && (
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-fast',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            value === option.id
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ═════════════════════════ account ═════════════════════════ */

/**
 * Identity, and an honest account of what it is worth.
 *
 * The temptation with an auth screen is to imply more than it does. Signing in
 * here buys cross-device sync and nothing else: there is no MadMusic server, so
 * no entitlement, no quota and no private data live behind this. Saying that
 * plainly costs a paragraph and prevents a whole category of wrong assumption.
 */
function AccountSettings() {
  const {
    configured,
    loading,
    signedIn,
    account,
    signIn,
    signOut,
    manageAccount,
  } = useAccount();

  if (!configured) {
    return (
      <Group
        title="Account"
        description="Accounts are not configured in this build."
      >
        <Row
          label="Sign-in unavailable"
          hint="No Clerk publishable key is set, so MadMusic runs without accounts. Everything except cross-device sync works exactly the same."
          control={null}
        />
      </Group>
    );
  }

  return (
    <>
      <Group title="Account">
        {loading ? (
          <Row label="Checking your session…" control={null} />
        ) : signedIn ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-sm font-semibold">
                  {account?.imageUrl ? (
                    <img
                      decoding="async"
                      src={account.imageUrl}
                      alt=""
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    (account?.name ?? '?').charAt(0).toUpperCase()
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {account?.name}
                  </p>
                  {account?.email && (
                    <p className="truncate text-xs text-muted-foreground">
                      {account.email}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={manageAccount}>
                  Manage
                </Button>
                <Button variant="ghost" size="sm" onClick={signOut}>
                  Sign out
                </Button>
              </div>
            </div>
            <Row
              label="Email, password and connected accounts"
              hint="Handled by Clerk, including two-factor and revoking Google access."
              control={
                <Button variant="outline" size="sm" onClick={manageAccount}>
                  Open
                </Button>
              }
            />
          </>
        ) : (
          <Row
            label="Not signed in"
            hint="Sign in with email or Google. MadMusic works fully without an account — this only adds sync."
            control={
              <Button size="sm" onClick={signIn}>
                Sign in
              </Button>
            }
          />
        )}
      </Group>

      <Group
        title="What signing in does"
        description="Worth being precise about, because it is less than most apps imply."
      >
        <Row
          label="Does not sync"
          hint="Likes, playlists and history stay on this machine. There is no MadMusic server to hold them, so instead of a switch that could never work there is a backup file — see Your data below."
          control={null}
        />
        <Row
          label="Does not gate anything"
          hint="There is no MadMusic server. Every check runs on your own machine, so signing in unlocks no content and restricts none — the catalogue and your folders behave identically either way."
          control={null}
        />
        <Row
          label="Does not see your files"
          hint="Local folders are read on-device and never leave it. No path, filename or audio is sent anywhere."
          control={null}
        />
        {authInstance === 'test' && (
          <Row
            label="Development instance"
            hint="This build points at a Clerk test instance (pk_test_…). Accounts created here are separate from a production instance and its sign-up restrictions do not apply."
            control={null}
          />
        )}
      </Group>
    </>
  );
}

/* ═════════════════════════ appearance ═════════════════════════ */

const MODES = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'amoled', label: 'AMOLED', icon: Contrast },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

function Appearance() {
  const { theme, setTheme } = useTheme();
  const { essence, setEssence, customAccent, setCustomAccent } = useEssence();
  const { settings, set } = useSettings();

  return (
    <>
      <Group
        title="Theme"
        description="Mode sets the surfaces; the accent sets the one colour that means “this is playing”. They are independent, so any accent works with any mode."
      >
        <div className="px-4 py-4">
          <p className="mb-3 text-sm font-medium">Mode</p>
          <div className="flex flex-wrap gap-2">
            {MODES.map(({ id, label, icon: Icon }) => {
              const active = (theme ?? 'system') === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-colors duration-fast',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    active
                      ? 'border-primary bg-accent/50'
                      : 'border-border hover:bg-accent/30',
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                  {active && <Check className="size-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">
            AMOLED is dark taken to true black — it saves power on OLED panels,
            which is why it is a mode rather than a switch.
          </p>
        </div>

        <div className="px-4 py-4">
          <p className="mb-3 text-sm font-medium">Accent</p>
          <div className="flex flex-wrap items-center gap-2">
            {ESSENCES.map(({ id, label, swatch }) => (
              <AccentChip
                key={id}
                label={label}
                swatch={swatch}
                active={essence === id}
                onClick={() => setEssence(id as Essence)}
              />
            ))}

            <label
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-fast',
                essence === 'custom'
                  ? 'border-primary bg-accent/50'
                  : 'border-border hover:bg-accent/30',
              )}
            >
              <input
                type="color"
                value={customAccent || DEFAULT_ACCENT}
                onChange={(event) => {
                  setCustomAccent(event.target.value);
                  setEssence('custom');
                }}
                className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="Custom accent colour"
              />
              Custom
            </label>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">
            Monochrome is the default: the accent becomes the text colour, so
            album art is the only colour on screen. A custom colour picks its
            own readable foreground automatically.
          </p>
        </div>
      </Group>

      <Group title="Layout">
        <Row
          label="Density"
          hint="Compact tightens row heights and shrinks artwork — useful on a laptop or with a very large library."
          control={
            <Choice<Density>
              value={settings.density}
              onChange={(value) => set('density', value)}
              options={[
                { id: 'comfortable', label: 'Comfortable' },
                { id: 'compact', label: 'Compact' },
              ]}
            />
          }
        />
        <Row
          label="Density per screen"
          hint="A nine-thousand-track library wants compact rows; home, which is six shelves of artwork, does not. Anything left on Follow uses the setting above."
          control={null}
        />
        <div className="flex flex-col gap-2 px-4 pb-4">
          {DENSITY_VIEWS.map(({ id, label }) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Choice<DensityChoice>
                value={choiceFor(id, settings.densityOverrides)}
                onChange={(value) =>
                  set(
                    'densityOverrides',
                    setChoice(settings.densityOverrides, id, value),
                  )
                }
                options={[
                  { id: 'follow', label: 'Follow' },
                  { id: 'comfortable', label: 'Comfortable' },
                  { id: 'compact', label: 'Compact' },
                ]}
              />
            </div>
          ))}
        </div>
        <Row
          label="Long result lists"
          hint="Search and Browse can keep loading as you scroll, or hand you a page at a time. Pages give you a scrollbar that means something and a position you can go back to; scrolling never makes you stop and decide."
          control={
            <Choice<PagingMode>
              value={settings.paging}
              onChange={(value) => set('paging', value)}
              options={[
                { id: 'infinite', label: 'Keep scrolling' },
                { id: 'pages', label: 'Pages' },
              ]}
            />
          }
        />
        <Row
          label="Show playlist artwork"
          hint="Turn off for a plain text sidebar."
          control={
            <Switch
              checked={settings.showPlaylistArt}
              onCheckedChange={(value) => set('showPlaylistArt', value)}
              aria-label="Show playlist artwork"
            />
          }
        />
      </Group>

      <Group
        title="Motion"
        description="Your system's reduced-motion preference is always honoured. These are the in-app overrides."
      >
        <Row
          label="Reduce motion"
          hint="Removes transitions and the equaliser animation even when the system does not ask for it."
          control={
            <Switch
              checked={settings.reduceMotion}
              onCheckedChange={(value) => set('reduceMotion', value)}
              aria-label="Reduce motion"
            />
          }
        />
        <Row
          label="Animated equaliser"
          hint="The dancing bars beside the current track."
          control={
            <Switch
              checked={settings.showEqualiser}
              onCheckedChange={(value) => set('showEqualiser', value)}
              aria-label="Animated equaliser"
            />
          }
        />
      </Group>
    </>
  );
}

function AccentChip({
  label,
  swatch,
  active,
  onClick,
}: {
  label: string;
  swatch: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-fast',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        active
          ? 'border-primary bg-accent/50'
          : 'border-border hover:bg-accent/30',
      )}
    >
      <span
        aria-hidden="true"
        className="size-4 rounded-full border border-border"
        style={{
          backgroundColor: swatch === 'currentColor' ? undefined : swatch,
          backgroundImage:
            swatch === 'currentColor'
              ? 'linear-gradient(135deg, var(--foreground) 50%, var(--muted) 50%)'
              : undefined,
        }}
      />
      {label}
    </button>
  );
}

/* ═════════════════════════ playback ═════════════════════════ */

function Playback() {
  const { settings, set } = useSettings();

  return (
    <>
      <Group title="Transport">
        <Row
          label="Seek step"
          hint="How far the arrow keys jump."
          control={
            <div className="flex w-48 items-center gap-3">
              <Slider
                value={[settings.seekStep]}
                min={1}
                max={30}
                step={1}
                onValueChange={([value]) => set('seekStep', value)}
                aria-label="Seek step"
                aria-valuetext={`${settings.seekStep} seconds`}
              />
              <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {settings.seekStep}s
              </span>
            </div>
          }
        />
        <Row
          label="Resume on launch"
          hint="Reopen with the last track loaded and paused."
          control={
            <Switch
              checked={settings.resumeOnLaunch}
              onCheckedChange={(value) => set('resumeOnLaunch', value)}
              aria-label="Resume on launch"
            />
          }
        />
        <Row
          label="Autoplay similar music"
          hint="Keep playing past the end of the queue."
          control={
            <Switch
              checked={settings.autoplaySimilar}
              onCheckedChange={(value) => set('autoplaySimilar', value)}
              aria-label="Autoplay similar music"
            />
          }
        />
      </Group>

      <Group title="Audio">
        <Row
          label="Crossfade"
          hint="Overlap between consecutive tracks, on an equal-power curve so the seam is inaudible."
          control={
            <div className="flex w-48 items-center gap-3">
              <Slider
                value={[settings.crossfade]}
                min={0}
                max={12}
                step={1}
                onValueChange={([value]) => set('crossfade', value)}
                aria-label="Crossfade"
                aria-valuetext={
                  settings.crossfade === 0
                    ? 'Off'
                    : `${settings.crossfade} seconds`
                }
              />
              <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {settings.crossfade === 0 ? 'Off' : `${settings.crossfade}s`}
              </span>
            </div>
          }
        />
        <Row
          label="Restore the queue on launch"
          hint="Bring back what was playing last time, paused where you left it."
          control={
            <Switch
              checked={settings.restoreQueueOnLaunch}
              onCheckedChange={(value) => set('restoreQueueOnLaunch', value)}
              aria-label="Restore the queue on launch"
            />
          }
        />
        <Row
          label="Volume curve"
          hint="Logarithmic matches how loudness is heard, so halfway along the slider sounds halfway. Linear is what most other players do."
          control={
            <Select
              value={settings.volumeCurve}
              onValueChange={(value) =>
                set('volumeCurve', value as typeof settings.volumeCurve)
              }
            >
              <SelectTrigger className="w-44" aria-label="Volume curve">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="logarithmic">Logarithmic</SelectItem>
                <SelectItem value="linear">Linear</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Smart crossfade"
          hint="Only fade between tracks that suit it. Never cuts an album apart, and never overlaps two very different tempos."
          control={
            <Switch
              checked={settings.smartCrossfade}
              onCheckedChange={(value) => set('smartCrossfade', value)}
              aria-label="Smart crossfade"
              disabled={settings.crossfade === 0}
            />
          }
        />
        <Row
          label="Beat-matched transitions"
          hint="Nudge the incoming track's speed into step during a crossfade. Only applied when the correction is small enough to stay inaudible."
          control={
            <Switch
              checked={settings.beatMatch}
              onCheckedChange={(value) => set('beatMatch', value)}
              aria-label="Beat-matched transitions"
              disabled={settings.crossfade === 0}
            />
          }
        />
        <Row
          label="Moving backdrop in full screen"
          hint="Two soft shapes in the track's own colours, drifting with the music. Held still for anybody who asked the system for reduced motion."
          control={
            <Switch
              checked={settings.trackVisuals}
              onCheckedChange={(value) => set('trackVisuals', value)}
              aria-label="Moving backdrop in full screen"
            />
          }
        />
        <Row
          label="Loudness meter"
          hint="A live level meter in the now-playing bar."
          control={
            <Switch
              checked={settings.showLoudnessMeter}
              onCheckedChange={(value) => set('showLoudnessMeter', value)}
              aria-label="Loudness meter"
            />
          }
        />
        <Row
          label="Keep playing when the machine sleeps"
          hint="Asks the system not to suspend during playback. Whether it is granted is the system's decision, not ours."
          control={
            <Switch
              checked={settings.keepPlayingAsleep}
              onCheckedChange={(value) => set('keepPlayingAsleep', value)}
              aria-label="Keep playing when the machine sleeps"
            />
          }
        />
        <Row
          label="Pass through multi-channel audio"
          hint="Send surround and spatial tracks to the output untouched instead of folding them down to stereo. Needs a device that accepts them."
          control={
            <Switch
              checked={settings.spatialPassthrough}
              onCheckedChange={(value) => set('spatialPassthrough', value)}
              aria-label="Pass through multi-channel audio"
            />
          }
        />
        <Row
          label="Fade on play and pause"
          hint="Eases the volume in and out instead of cutting, which removes the click at the start of a loud track."
          control={
            <div className="flex w-48 items-center gap-3">
              <Slider
                value={[Math.round(settings.playPauseFade * 1000)]}
                min={0}
                max={500}
                step={20}
                onValueChange={([value]) => set('playPauseFade', value / 1000)}
                aria-label="Fade on play and pause"
                aria-valuetext={
                  settings.playPauseFade < 0.03
                    ? 'Off'
                    : `${Math.round(settings.playPauseFade * 1000)} milliseconds`
                }
              />
              <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {settings.playPauseFade < 0.03
                  ? 'Off'
                  : `${Math.round(settings.playPauseFade * 1000)}ms`}
              </span>
            </div>
          }
        />
        <Row
          label="Gapless playback"
          hint="No silence between tracks. The next one starts decoding before this one ends."
          control={
            <Switch
              checked={settings.gapless}
              onCheckedChange={(value) => set('gapless', value)}
              aria-label="Gapless playback"
            />
          }
        />
        <Row
          label="Normalise volume"
          hint="Evens out loudness using the measurement the catalogue reports. Only ever quietens — boosting a quiet master clips it."
          control={
            <Switch
              checked={settings.normaliseVolume}
              onCheckedChange={(value) => set('normaliseVolume', value)}
              aria-label="Normalise volume"
            />
          }
        />
        <Row
          label="Streaming quality"
          hint="Higher costs more bandwidth. The catalogue is lossy at every setting — lossless was traded away deliberately."
          control={
            <Choice<Quality>
              value={settings.quality}
              onChange={(value) => set('quality', value)}
              options={[
                { id: 'low', label: 'Data saver' },
                { id: 'balanced', label: 'Balanced' },
                { id: 'high', label: 'High' },
              ]}
            />
          }
        />
      </Group>
    </>
  );
}

/* ═════════════════════════ catalogue ═════════════════════════ */

function Catalogue() {
  const { settings, set } = useSettings();
  const offline = useOffline();

  return (
    <>
      <Group
        title="Source"
        description="MadMusic resolves audio in-app rather than through a server. Nothing here talks to a backend of ours, because there isn't one."
      >
        <Row
          label="Provider"
          hint="Preview is the bundled placeholder catalogue. YouTube Music arrives with the Rust extractor."
          control={
            <span className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
              Preview catalogue
            </span>
          }
        />
      </Group>

      <Group title="Network and storage">
        <Row
          label="Prefetch next track"
          hint="Start fetching before the current track ends, so playback never gaps."
          control={
            <Switch
              checked={settings.prefetchNext}
              onCheckedChange={(value) => set('prefetchNext', value)}
              aria-label="Prefetch next track"
            />
          }
        />
        <Row
          label="On disk"
          hint={
            offline.supported
              ? `${formatBytes(offline.cached)} cached, ${formatBytes(offline.downloaded)} downloaded. Downloads are not counted against the limit and are never evicted.`
              : 'Caching and downloads need the desktop app. In the browser there is no disk to write to.'
          }
          control={
            <Button
              variant="outline"
              onClick={() => void offline.clearCache()}
              disabled={!offline.supported || offline.cached === 0}
            >
              Clear cache
            </Button>
          }
        />
        <Row
          label="Cache limit"
          hint="How much played audio is kept on disk. Downloads are not counted and are never evicted."
          control={
            <div className="flex w-48 items-center gap-3">
              <Slider
                value={[settings.cacheLimitMb]}
                min={256}
                max={16384}
                step={256}
                onValueChange={([value]) => set('cacheLimitMb', value)}
                aria-label="Cache limit"
                aria-valuetext={`${(settings.cacheLimitMb / 1024).toFixed(1)} gigabytes`}
              />
              <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {(settings.cacheLimitMb / 1024).toFixed(1)} GB
              </span>
            </div>
          }
        />
        <Row
          label="Clear cache"
          hint="Nothing is cached yet."
          control={
            <Button variant="outline" size="sm" disabled>
              Clear
            </Button>
          }
        />
      </Group>
    </>
  );
}

/* ═════════════════════════ library ═════════════════════════ */

function LibrarySettings() {
  const { root, sourceKind, picking, scanning, chooseFolder, clearFolder } =
    useLibrary();
  const { settings, set } = useSettings();

  return (
    <>
      <Group
        title="Local folder"
        description="Optional. MadMusic is a catalogue player first, but it will read a folder on this machine and show it alongside."
      >
        {root ? (
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded bg-accent/40">
                <Folder className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{root.name}</p>
                <p
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={root.path}
                >
                  {root.path}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={chooseFolder}
                disabled={picking || scanning}
              >
                Change
              </Button>
              <Button variant="ghost" size="sm" onClick={clearFolder}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <Row
            label="No folder chosen"
            hint={
              sourceKind === 'unavailable'
                ? 'This browser cannot open local folders. Use the desktop app, or a Chromium-based browser.'
                : 'Everything inside the folder is read, however deeply nested.'
            }
            control={
              <Button
                size="sm"
                onClick={chooseFolder}
                disabled={picking || sourceKind === 'unavailable'}
              >
                Choose folder
              </Button>
            }
          />
        )}

        {/* The multi-folder list sits below the primary folder rather than
            replacing it: the single-folder flow above is the common case and
            the one the empty state teaches, and moving it would make the
            first run harder to explain in order to serve the rarer case. */}
        <FolderManager />

        <Row
          label="Restore folder on launch"
          hint="Re-open the last folder automatically. Turn off if it lives on a drive you unplug."
          control={
            <Switch
              checked={settings.restoreLibraryOnLaunch}
              onCheckedChange={(value) => set('restoreLibraryOnLaunch', value)}
              aria-label="Restore folder on launch"
            />
          }
        />
        <Row
          label="Watch for changes"
          hint="Re-scan when files are added or removed while the app is open."
          control={
            <Switch
              checked={settings.watchFolder}
              onCheckedChange={(value) => set('watchFolder', value)}
              aria-label="Watch for changes"
            />
          }
        />
      </Group>

      <Group title="Supported formats">
        <div className="px-4 py-4">
          <div className="flex flex-wrap gap-1.5">
            {[
              'MP3',
              'FLAC',
              'M4A',
              'AAC',
              'OGG',
              'Opus',
              'WAV',
              'WMA',
              'AIFF',
              'ALAC',
            ].map((format) => (
              <span
                key={format}
                className="rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground"
              >
                {format}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Tags, durations and embedded artwork are read from the files
            themselves — nothing is fetched to display your own music.
          </p>
        </div>
      </Group>
    </>
  );
}

/* ═════════════════════════ general ═════════════════════════ */

function General() {
  const { settings, set } = useSettings();

  return (
    <Group title="Application">
      <Row
        label="Open on"
        hint="Which screen MadMusic shows at launch."
        control={
          <Choice<StartupView>
            value={settings.startupView}
            onChange={(value) => set('startupView', value)}
            options={[
              { id: 'home', label: 'Home' },
              { id: 'library', label: 'Library' },
              { id: 'last', label: 'Last used' },
            ]}
          />
        }
      />
      <Row
        label="Media keys"
        hint="Hardware play/pause keys and headset buttons."
        control={
          <Switch
            checked={settings.mediaKeys}
            onCheckedChange={(value) => set('mediaKeys', value)}
            aria-label="Media keys"
          />
        }
      />
      <Row
        label="Minimise to tray"
        hint="Keep playing when the window is closed."
        control={
          <Switch
            checked={settings.minimiseToTray}
            onCheckedChange={(value) => set('minimiseToTray', value)}
            aria-label="Minimise to tray"
          />
        }
      />
      <Row
        label="Confirm before quitting while playing"
        control={
          <Switch
            checked={settings.confirmOnQuitWhilePlaying}
            onCheckedChange={(value) => set('confirmOnQuitWhilePlaying', value)}
            aria-label="Confirm before quitting while playing"
          />
        }
      />
    </Group>
  );
}

/* ═════════════════════════ keyboard ═════════════════════════ */

const SHORTCUTS: [string, string[]][] = [
  ['Play / pause', ['Space']],
  ['Previous track', ['Ctrl', '←']],
  ['Next track', ['Ctrl', '→']],
  ['Seek backward', ['←']],
  ['Seek forward', ['→']],
  ['Mute', ['M']],
  ['Shuffle', ['S']],
  ['Cycle repeat', ['R']],
  ['Command palette', ['Ctrl', 'K']],
  ['Search', ['Ctrl', 'F']],
  ['Toggle sidebar', ['Ctrl', 'B']],
  ['Toggle queue', ['Ctrl', 'Q']],
  ['Settings', ['Ctrl', ',']],
  ['Back', ['Alt', '←']],
  ['Forward', ['Alt', '→']],
];

function Shortcuts() {
  return (
    <Group
      title="Shortcuts"
      description="Playback keys work from anywhere in the window, except while a text field has focus — a player that pauses when you type a space is broken."
    >
      <ul className="divide-y divide-border">
        {SHORTCUTS.map(([label, keys]) => (
          <li
            key={label}
            className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="flex shrink-0 gap-1">
              {keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Group>
  );
}

/* ═════════════════════════ privacy ═════════════════════════ */

function Privacy() {
  const { settings, set } = useSettings();
  const { exportAll, importAll } = useSaved();
  const [pending, setPending] = useState<string | null>(null);
  const desktop = isDesktop();

  /**
   * Writing and reading the backup file.
   *
   * The dialogs live in Rust — see `src-tauri/src/backup.rs` — so the only path
   * ever touched is one the user picked during this call, and the webview never
   * needs filesystem access of its own.
   */
  async function onExport() {
    try {
      const path = await exportToFile(exportAll());
      // `null` means the save dialog was dismissed, which is not a failure and
      // should not be announced as one.
      if (path) toast.success('Library exported', { description: path });
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : 'Could not export your library.',
      );
    }
  }

  /**
   * Reads the file, then shows what the import would do.
   *
   * The merge itself is unchanged; what is new is that it no longer happens
   * behind the user's back. See `ImportPreview`.
   */
  async function onImport() {
    try {
      const text = await importFromFile();
      if (!text) return;
      setPending(text);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not read that backup.',
      );
    }
  }

  function applyImport(text: string) {
    setPending(null);
    try {
      const summary = importAll(text);
      const parts = [
        summary.liked && `${summary.liked} liked`,
        summary.playlists && `${summary.playlists} playlists`,
        summary.history && `${summary.history} history entries`,
      ].filter(Boolean);

      // Naming what arrived, because "imported" over a file that turned out to
      // be a duplicate looks identical to one that did nothing.
      toast.success(
        parts.length > 0
          ? `Imported ${parts.join(', ')}`
          : 'Nothing new to import',
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not read that backup.',
      );
    }
  }

  return (
    <>
      {/* Mounted only while a file is waiting, so it reads the backup it was
          handed rather than resetting itself in an effect. */}
      {pending !== null && (
        <ImportPreview
          text={pending}
          onCancel={() => setPending(null)}
          onConfirm={() => applyImport(pending)}
        />
      )}

      <Group
        title="Offline"
        description="For a train, a plane, or a connection somebody is paying for by the megabyte."
      >
        <Row
          label="Only show what can be played"
          hint="Hides catalogue tracks that are not downloaded. Not the same as being offline - you may want this on while perfectly able to reach the network."
          control={
            <Switch
              checked={settings.offlineOnly}
              onCheckedChange={(value) => set('offlineOnly', value)}
              aria-label="Only show what can be played"
            />
          }
        />
      </Group>

      <Group
        title="Automatic backups"
        description="A backup you have to remember is a backup you have on the day you thought about it, and not on the day the drive failed."
      >
        <Row
          label="How often"
          hint="Written into the folder below. Five are kept, so a corrupted one never destroys the only copy."
          control={
            <Select
              value={settings.autoBackup}
              onValueChange={(value) =>
                set('autoBackup', value as typeof settings.autoBackup)
              }
              disabled={!isNative()}
            >
              <SelectTrigger className="w-40" aria-label="Backup frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Never</SelectItem>
                <SelectItem value="daily">Every day</SelectItem>
                <SelectItem value="weekly">Every week</SelectItem>
                <SelectItem value="monthly">Every month</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Backup folder"
          hint={
            settings.autoBackupFolder ||
            'Nowhere chosen yet. Somewhere that is itself backed up is the point — a second copy on the same disk is not a backup.'
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={!isNative()}
              onClick={() => {
                void (async () => {
                  const { open } = await import('@tauri-apps/plugin-dialog');
                  const picked = await open({ directory: true });
                  if (typeof picked === 'string') {
                    set('autoBackupFolder', picked);
                  }
                })();
              }}
            >
              Choose
            </Button>
          }
        />
      </Group>

      <Group
        title="Data"
        description="MadMusic has no backend of its own. Nothing you do here is sent to us, because there is nowhere to send it."
      >
        <Row
          label="Keep listening history"
          hint="Powers “jump back in” and recently played. Stored on this device only."
          control={
            <Switch
              checked={settings.keepHistory}
              onCheckedChange={(value) => set('keepHistory', value)}
              aria-label="Keep listening history"
            />
          }
        />
        <Scrobbling />
        <Row
          label="Back up your library"
          hint="Writes likes, playlists, history and preferences to a JSON file you keep. This is what moves a library to another machine."
          control={
            <Button
              animate
              variant="outline"
              onClick={onExport}
              disabled={!desktop}
            >
              <Download className="size-4" />
              Export
            </Button>
          }
        />
        <Row
          label="Restore from a backup"
          hint="Merges a backup into what is here rather than replacing it, so importing on a machine that already has likes keeps both."
          control={
            <Button
              animate
              variant="outline"
              onClick={onImport}
              disabled={!desktop}
            >
              <FolderOpen className="size-4" />
              Import
            </Button>
          }
        />
        <Row
          label="Clear local data"
          hint="Preferences, listening history and the remembered folder."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                localStorage.clear();
                location.reload();
              }}
            >
              Clear
            </Button>
          }
        />
      </Group>
    </>
  );
}

/* ═════════════════════════ about ═════════════════════════ */

/**
 * Connecting a Last.fm account.
 *
 * The whole row is absent when the build has no credentials, rather than
 * present and disabled. `settings.ts` states the rule — a control that does
 * nothing is worse than no control — and without a key this one can never do
 * anything, so there is nothing to explain to the user and nothing they could
 * fix.
 *
 * Two steps, because Last.fm's desktop flow is two-legged: approve in a
 * browser, then come back. The second button appears only once the first has
 * opened the page, so the order cannot be got wrong.
 */
function Scrobbling() {
  const { settings, set } = useSettings();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [can, who] = await Promise.all([
        lastfm.available(),
        lastfm.account(),
      ]);
      if (cancelled) return;
      setSupported(can);
      setUsername(who);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // `null` is "still asking". Rendering the row and then removing it would
  // make the settings list jump on every visit.
  if (supported !== true) return null;

  async function connect() {
    try {
      const { token, url } = await lastfm.begin();
      setPendingToken(token);
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      toast('Approve MadMusic in your browser, then choose Finish.');
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not reach Last.fm.',
      );
    }
  }

  async function finish() {
    if (!pendingToken) return;
    try {
      const who = await lastfm.finish(pendingToken);
      setUsername(who);
      setPendingToken(null);
      set('scrobble', true);
      toast.success(`Connected as ${who}`);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Last.fm refused that.',
      );
    }
  }

  return (
    <>
      <Row
        label="Scrobble to Last.fm"
        hint={
          username
            ? `Plays are reported to ${username}. Only artist, title and album leave this machine.`
            : 'Reports what you play to your own Last.fm account, which builds a listening history you keep. Connect an account first.'
        }
        control={
          <Switch
            checked={settings.scrobble && Boolean(username)}
            disabled={!username}
            onCheckedChange={(value) => set('scrobble', value)}
            aria-label="Scrobble to Last.fm"
          />
        }
      />
      <Row
        label={username ? 'Last.fm account' : 'Connect Last.fm'}
        hint={
          username
            ? 'Disconnecting stops scrobbling and forgets the session on this machine.'
            : 'Opens Last.fm in your browser to approve MadMusic, then finishes here.'
        }
        control={
          username ? (
            <Button
              variant="outline"
              onClick={() => {
                void lastfm.disconnect().then(() => {
                  setUsername(null);
                  set('scrobble', false);
                });
              }}
            >
              Disconnect
            </Button>
          ) : pendingToken ? (
            <Button onClick={() => void finish()}>Finish connecting</Button>
          ) : (
            <Button variant="outline" onClick={() => void connect()}>
              Connect
            </Button>
          )
        }
      />

      {/* Only where an account is actually connected: a sync button with
          nothing to sync from is a button that can only fail. */}
      {username && <LovedSync />}
    </>
  );
}

function About({ onOpenLegal }: { onOpenLegal: () => void }) {
  return (
    <Group title="About">
      <Row
        label="MadMusic"
        hint="One music library, every device."
        control={
          <span className="font-mono text-xs text-muted-foreground">0.1.0</span>
        }
      />
      <Row
        label="Catalogue"
        hint="Audio is resolved and extracted in-app. No server, no subscription, no account."
        control={null}
      />
      <Row
        label="Licence"
        hint="MadMusic itself is proprietary and pre-alpha. It is built on hundreds of open-source packages, each under its own licence."
        control={null}
      />
      <Row
        label="Privacy and licences"
        hint="What the app does with your data, in specific claims rather than a policy — and the generated list of everything it is built from."
        control={
          <Button variant="outline" size="sm" onClick={onOpenLegal}>
            Open
          </Button>
        }
      />
    </Group>
  );
}

/**
 * The sidebar arrangement panel.
 *
 * Lives here rather than in `settings-extra` because it is the one section the
 * default category renders. Left there, opening Settings pulled that whole
 * module in eagerly and the lazy boundary below bought nothing.
 */
export function SidebarSettings() {
  const { layout, setLayout, reset, ready } = useSidebarLayout();

  const native = isNative();
  const backend = backendAvailable;

  // The catalogue order, but with whatever the user arranged first — so the
  // list here reads in the same order as the sidebar it describes.
  const ordered = [
    ...layout.order,
    ...SIDEBAR_ITEMS.map((item) => item.id).filter(
      (id) => !layout.order.includes(id),
    ),
  ]
    .map((id) => SIDEBAR_ITEMS.find((item) => item.id === id))
    .filter(
      (item): item is (typeof SIDEBAR_ITEMS)[number] => item !== undefined,
    )
    // Only what the bar can actually show. Search, browse, settings, liked
    // songs and recently played each have their own control elsewhere, and
    // offering to reorder one of those would be a row that does nothing.
    .filter((item) => !BAR_EXCLUDES.has(item.id));

  return (
    <Group
      title="Navigation"
      description="The destinations in the top bar. Hide what you never open; move what you open most to the front — the first few get an icon and the rest go in the menu."
    >
      {!ready ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Loading your arrangement…
        </div>
      ) : (
        <>
          {ordered.map((item, index) => {
            const unavailable =
              (item.needsDesktop && !native) || (item.needsBackend && !backend);
            const hidden = layout.hidden.includes(item.id);

            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <Grip
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  {unavailable && (
                    <p className="text-xs text-muted-foreground">
                      {item.needsDesktop
                        ? 'Desktop app only.'
                        : 'Needs a backend to be configured.'}
                    </p>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${item.label} up`}
                  disabled={index === 0}
                  onClick={() => setLayout(move(layout, item.id, index - 1))}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${item.label} down`}
                  disabled={index === ordered.length - 1}
                  onClick={() => setLayout(move(layout, item.id, index + 1))}
                >
                  ↓
                </Button>

                <Switch
                  checked={!hidden}
                  disabled={item.required}
                  onCheckedChange={() =>
                    setLayout(toggleHidden(layout, item.id))
                  }
                  aria-label={`Show ${item.label} in the sidebar`}
                />
              </div>
            );
          })}

          <div className="flex justify-end px-4 py-3">
            <Button variant="ghost" size="sm" onClick={reset}>
              Reset the sidebar
            </Button>
          </div>
        </>
      )}
    </Group>
  );
}
