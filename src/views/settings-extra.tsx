import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { useSettings } from '@/components/common/settings-context';
import { useLibrary } from '@/components/library/library-context';
import { useAppearance } from '@/components/common/appearance-context';
import { EqualiserPanel } from '@/components/player/equaliser-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  outputDevices,
  onDeviceChange,
  type OutputDevice,
} from '@/lib/audio/devices';
import {
  TEXT_SCALES,
  allSchemes,
  schemeProblem,
  type Scheme,
} from '@/lib/appearance';
import { LOCALES } from '@/lib/i18n';
import {
  EXPLICIT_FILTER_NOTE,
  activeProfile,
  createProfile,
  deleteProfile,
  isPrivate,
  profiles,
  resetTaste,
  setPrivate,
  subscribeToPrivate,
  switchProfile,
} from '@/lib/profiles';
import type { Profile } from '@/lib/store/types';
import { backendStatus } from '@/lib/convex-client';
import { syncStatus, forgetLocalSync, type SyncStatus } from '@/lib/sync';
import { downloader, formatBytes } from '@/lib/downloads';
import { store } from '@/lib/store';
import {
  REMOTE_OFF,
  remoteStatus,
  reissueRemoteToken,
  type RemoteStatus,
} from '@/lib/os-media';
import {
  ACTION_LABELS,
  DEFAULT_KEYS,
  accelerator,
  applyGlobalKeys,
  conflictFor,
  describeKey,
  loadGlobalKeys,
  loadKeyMap,
  saveGlobalKeys,
  saveKeyMap,
  type Action,
  type GlobalBinding,
  type KeyMap,
} from '@/lib/shortcuts';
import {
  checkForUpdate,
  installUpdate,
  loadChannel,
  restartApp,
  saveChannel,
  type Channel,
  type UpdateInfo,
} from '@/lib/updates';
import {
  feedbackUrl,
  loadTelemetry,
  saveTelemetry,
  type TelemetryChoice,
} from '@/lib/telemetry';
import { HealthReport } from '@/components/library/health-report';
/** Where the audio cache is, and where it will be after a restart. */
type CacheWhere = {
  active: string;
  chosen: string;
  restartNeeded: boolean;
};

import { toast } from 'sonner';
import { BlockedManager } from '@/components/library/blocked-manager';
import { PlaylistFolders } from '@/components/library/playlist-folders';
import { isNative, tryInvoke } from '@/lib/native';
import {
  describeEngine,
  engine,
  ENGINE_IDLE,
  type EngineState,
} from '@/lib/native-engine';
import {
  DuplicatesDialog,
  ImportDialog,
  PlaylistHistoryDialog,
} from '@/components/library/library-tools';

/**
 * The settings that arrived with the second wave of features.
 *
 * Kept in their own file rather than appended to `settings-view.tsx`, which was
 * already twelve hundred lines. The building blocks — `Group`, `Row`, `Choice`
 * — are re-declared here rather than exported from there, because exporting a
 * non-component from a file full of components breaks React Fast Refresh for
 * that file, and the settings screen is one of the places where losing Fast
 * Refresh hurts most.
 */

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

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
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

/* ═════════════════════════ audio ═════════════════════════ */

/**
 * Everything that changes what comes out of the speakers.
 *
 * The equaliser's limitation is stated at the top rather than buried: it works
 * on streamed tracks and not on your own files, because Web Audio cannot touch
 * a source that does not grant access and routing one through it anyway
 * produces silence.
 */
export function AudioSettingsSection() {
  const { settings, set } = useSettings();
  const [devices, setDevices] = useState<OutputDevice[]>([]);

  useEffect(() => {
    const load = () => void outputDevices().then(setDevices);
    load();
    // Hardware is plugged in and out while the app is open, and a device list
    // that was correct at mount is wrong the moment somebody connects
    // headphones.
    return onDeviceChange(load);
  }, []);

  return (
    <>
      <Group
        title="Equaliser"
        description="Ten bands, a preamp and a separate bass shelf."
      >
        <div className="px-4 py-4">
          <EqualiserPanel />
        </div>
      </Group>

      <Group
        title="Loudness"
        description="Making one track as loud as the next, without making anything clip."
      >
        <Row
          label="Normalise volume"
          hint="Uses the loudness measurement in the track's own tags where there is one. Tracks with no measurement are left alone rather than guessed at."
          control={
            <Switch
              checked={settings.normaliseVolume}
              onCheckedChange={(value) => set('normaliseVolume', value)}
            />
          }
        />
        <Row
          label="Target loudness"
          hint="Quiet suits a still room; loud suits a bus, where the quiet passages of a well-mastered record are inaudible."
          control={
            <Select
              value={settings.loudnessProfile}
              disabled={!settings.normaliseVolume}
              onValueChange={(value) =>
                set('loudnessProfile', value as typeof settings.loudnessProfile)
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quiet">Quiet</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="loud">Loud</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Keep album dynamics"
          hint="Uses one gain for a whole album rather than per track, so a record that was mastered quiet-then-loud stays that way."
          control={
            <Switch
              checked={settings.albumGain}
              disabled={!settings.normaliseVolume}
              onCheckedChange={(value) => set('albumGain', value)}
            />
          }
        />
        <Row
          label="Loudness compensation"
          hint="Lifts bass and treble at low volume, compensating for how hearing works. Off by default: it changes the mix."
          control={
            <Switch
              checked={settings.loudnessCompensation}
              onCheckedChange={(value) => set('loudnessCompensation', value)}
            />
          }
        />
      </Group>

      <Group
        title="Output"
        description="Where the sound goes, and how it gets there."
      >
        <Row
          label="Output device"
          hint={
            devices.length <= 1
              ? 'Only the system default is available. Device names are hidden until a page has been granted microphone access, which this app deliberately never asks for.'
              : 'Volume is remembered per device, so unplugging headphones does not make you jump.'
          }
          control={
            <Select
              value={settings.outputDevice}
              onValueChange={(value) => set('outputDevice', value)}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.id} value={device.id}>
                    {device.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Play local files natively"
          hint="Decodes in Rust at the file's own sample rate, bypassing the browser's resampler. Inaudible to almost everybody; the entire point for a few. Crossfade and the equaliser do not apply on this path."
          control={
            <Switch
              checked={settings.nativeOutput}
              disabled={!isNative()}
              onCheckedChange={(value) => set('nativeOutput', value)}
            />
          }
        />
        {settings.nativeOutput && isNative() && <NativeOutputStatus />}

        <Row
          label="Mono audio"
          hint="Folds both channels together. An accessibility control rather than an effect."
          control={
            <Switch
              checked={settings.monoAudio}
              onCheckedChange={(value) => set('monoAudio', value)}
            />
          }
        />
        <Row
          label="Balance"
          hint={
            settings.balance === 0
              ? 'Centred.'
              : settings.balance < 0
                ? `${Math.round(-settings.balance * 100)}% left`
                : `${Math.round(settings.balance * 100)}% right`
          }
          control={
            <div className="flex w-48 items-center gap-2">
              <Slider
                min={-1}
                max={1}
                step={0.05}
                value={[settings.balance]}
                onValueChange={([value]) => set('balance', value)}
                aria-label="Balance"
              />
              {settings.balance !== 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => set('balance', 0)}
                >
                  Centre
                </Button>
              )}
            </div>
          }
        />
      </Group>

      <Group title="Transport" description="What the controls do.">
        <Row
          label="Skip silence"
          hint="Jumps past digital black at the start and end of a track. Needs a waveform, which is built in the background when that setting is on."
          control={
            <Switch
              checked={settings.skipSilence}
              onCheckedChange={(value) => set('skipSilence', value)}
            />
          }
        />
        <Row
          label="“Previous” restarts after"
          hint="Below this, Previous goes back a track. Above it, Previous starts this one again."
          control={
            <div className="flex w-40 items-center gap-3">
              <Slider
                min={0}
                max={15}
                step={1}
                value={[settings.restartThreshold]}
                onValueChange={([value]) => set('restartThreshold', value)}
                aria-label="Restart threshold in seconds"
              />
              <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                {settings.restartThreshold}s
              </span>
            </div>
          }
        />
        <Row
          label="Fade on play and pause"
          hint="A very short ramp, so pausing does not click."
          control={
            <div className="flex w-40 items-center gap-3">
              <Slider
                min={0}
                max={1}
                step={0.02}
                value={[settings.playPauseFade]}
                onValueChange={([value]) => set('playPauseFade', value)}
                aria-label="Play and pause fade in seconds"
              />
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {settings.playPauseFade === 0
                  ? 'Off'
                  : `${settings.playPauseFade.toFixed(2)}s`}
              </span>
            </div>
          }
        />
      </Group>
    </>
  );
}

/* ═════════════════════════ offline ═════════════════════════ */

export function OfflineSettings() {
  const [cacheWhere, setCacheWhere] = useState<CacheWhere | null>(null);
  // Needed so choosing an override can re-apply the destination immediately:
  // the backend decides between the override and the Local folder, and it can
  // only do that if it is told both.
  const { root } = useLibrary();

  // Read once. The location only changes when the button below changes it,
  // and that path refreshes this itself.
  useEffect(() => {
    void tryInvoke<CacheWhere | null>('cache_location', undefined, null).then(
      setCacheWhere,
    );
  }, []);

  const { settings, set } = useSettings();
  const [usage, setUsage] = useState(0);

  useEffect(() => {
    void store
      .downloads()
      .then((rows) =>
        setUsage(
          rows
            .filter((row) => row.state === 'done')
            .reduce((sum, row) => sum + row.bytes, 0),
        ),
      )
      .catch(() => setUsage(0));
  }, []);

  // The worker reads both of these before every fetch, so changing them here
  // takes effect on the next track rather than at the next launch.
  useEffect(() => {
    downloader.wifiOnly = settings.downloadOnWifiOnly;
    downloader.quality = settings.downloadQuality;
  }, [settings.downloadOnWifiOnly, settings.downloadQuality]);

  return (
    <>
      <Group
        title="Downloads"
        description="Tracks you asked to keep. They are written into your Local folder as ordinary files, so they show up beside the rest of your music — and unlike the cache they are never evicted to make room."
      >
        <Row
          label="Keep downloads somewhere else"
          hint={
            cacheWhere
              ? cacheWhere.restartNeeded
                ? `Downloads go to ${cacheWhere.chosen} from now on. The cache moves there when the app restarts; nothing is copied, so the old folder can be deleted once you are happy.`
                : `Your Local folder, unless you choose otherwise. The cache stays in ${cacheWhere.active}.`
              : 'Loading…'
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
                  if (typeof picked !== 'string') return;

                  const moved = await tryInvoke<boolean>(
                    'cache_set_location',
                    { folder: picked },
                    false,
                  );
                  if (!moved) {
                    toast.error('Could not use that folder');
                    return;
                  }
                  // Applied to downloads at once - the destination is read
                  // per download rather than at startup, so making the user
                  // restart for it would be a restart for nothing. The cache
                  // root genuinely does need one, which the hint says.
                  await tryInvoke(
                    'cache_set_downloads_root',
                    { folder: root?.path ?? null },
                    null,
                  );
                  toast.success('Set. Downloads go there from now on.');
                  void tryInvoke<CacheWhere | null>(
                    'cache_location',
                    undefined,
                    null,
                  ).then(setCacheWhere);
                })();
              }}
            >
              Choose
            </Button>
          }
        />
        <Row
          label="Download the next few tracks"
          hint="Keeps five tracks ahead of you on disk, so the queue keeps playing through a tunnel. Different from prefetching, which only removes the pause between tracks."
          control={
            <Switch
              checked={settings.downloadAhead}
              onCheckedChange={(value) => set('downloadAhead', value)}
              disabled={!isNative()}
            />
          }
        />
        <Row
          label="Download quality"
          hint="Separate from streaming quality: it is worth keeping a better copy of something you chose to keep."
          control={
            <Select
              value={settings.downloadQuality}
              onValueChange={(value) =>
                set('downloadQuality', value as typeof settings.downloadQuality)
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Data saver</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Only over Wi-Fi"
          hint="Checked before every track, not once — so starting a download and walking out of the building pauses it rather than finishing it on mobile data."
          control={
            <Switch
              checked={settings.downloadOnWifiOnly}
              onCheckedChange={(value) => set('downloadOnWifiOnly', value)}
            />
          }
        />
        <Row
          label="Downloaded"
          hint="Pinned audio on this machine."
          control={
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatBytes(usage)}
            </span>
          }
        />
      </Group>

      <Group
        title="Connection"
        description="What to do when the network cannot keep up."
      >
        <Row
          label="Drop quality automatically"
          hint="Only downwards, and only after the buffer has been thin for a while. A quality that flips every few seconds is more annoying than the stall it avoids."
          control={
            <Switch
              checked={settings.adaptiveQuality}
              onCheckedChange={(value) => set('adaptiveQuality', value)}
            />
          }
        />
        <Row
          label="Data saver"
          hint="Fetches nothing but audio: no artwork, no biographies, no charts."
          control={
            <Switch
              checked={settings.dataSaver}
              onCheckedChange={(value) => set('dataSaver', value)}
            />
          }
        />
      </Group>
    </>
  );
}

/* ═════════════════════════ accessibility ═════════════════════════ */

export function AccessibilitySettings() {
  const {
    accessibility,
    setAccessibility,
    locale,
    setLocale,
    scheme,
    custom,
    setScheme,
    tintFromArtwork,
    setTintFromArtwork,
  } = useAppearance();

  return (
    <>
      <Group
        title="Reading"
        description="These are not buried in a corner, because burying them makes them hardest to find for the people who need them."
      >
        <Row
          label="Text size"
          hint="Independent of the system setting, which changes every application."
          control={
            <Select
              value={String(accessibility.textScale)}
              onValueChange={(value) =>
                setAccessibility({ ...accessibility, textScale: Number(value) })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEXT_SCALES.map((scale) => (
                  <SelectItem key={scale} value={String(scale)}>
                    {Math.round(scale * 100)}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="High contrast"
          hint="A palette built for contrast rather than for looks."
          control={
            <Switch
              checked={accessibility.highContrast}
              onCheckedChange={(value) =>
                setAccessibility({ ...accessibility, highContrast: value })
              }
            />
          }
        />
        <Row
          label="Reduce transparency"
          hint="Removes the translucent surfaces, which some people find illegible."
          control={
            <Switch
              checked={accessibility.reduceTransparency}
              onCheckedChange={(value) =>
                setAccessibility({
                  ...accessibility,
                  reduceTransparency: value,
                })
              }
            />
          }
        />
        <Row
          label="Always underline links"
          hint="Rather than only on hover, so a link is identifiable without a pointer."
          control={
            <Switch
              checked={accessibility.alwaysUnderline}
              onCheckedChange={(value) =>
                setAccessibility({ ...accessibility, alwaysUnderline: value })
              }
            />
          }
        />
        <Row
          label="Stronger focus ring"
          hint="Thicker and higher contrast, for keyboard navigation."
          control={
            <Switch
              checked={accessibility.strongFocus}
              onCheckedChange={(value) =>
                setAccessibility({ ...accessibility, strongFocus: value })
              }
            />
          }
        />
      </Group>

      <Group
        title="Language"
        description="The interface language and its direction."
      >
        <Row
          label="Language"
          hint="Only English is complete. The others are listed because a partly translated language is more useful to somebody than an absence they cannot interpret."
          control={
            <Select value={locale.tag} onValueChange={setLocale}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((entry) => (
                  <SelectItem key={entry.tag} value={entry.tag}>
                    {entry.endonym}
                    {!entry.complete && ' (partial)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </Group>

      <Group
        title="Colour"
        description="A scheme of your own, or the artwork's."
      >
        <Row
          label="Colour scheme"
          control={
            <Select value={scheme?.id ?? ''} onValueChange={setScheme}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="App theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">App theme</SelectItem>
                {allSchemes(custom).map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Tint from artwork"
          hint="Washes the now-playing surfaces with the current cover's dominant colour. Every colour is pushed to a lightness that keeps text readable, whatever the sleeve looks like."
          control={
            <Switch
              checked={tintFromArtwork}
              onCheckedChange={setTintFromArtwork}
            />
          }
        />
        <div className="px-4 py-4">
          <SchemeEditor />
        </div>
      </Group>
    </>
  );
}

/**
 * Building a colour scheme.
 *
 * Refuses to save one whose text fails contrast against its background. That is
 * not paternalism — it is the one check that stops somebody building an
 * interface they cannot read and then having no way to get back, since the
 * controls for changing it would be unreadable too.
 */
function SchemeEditor() {
  const { custom, saveCustomScheme, deleteCustomScheme } = useAppearance();
  const [draft, setDraft] = useState<Scheme>(() => ({
    // Minted inside the initialiser rather than in the object literal: reading
    // the clock during a render is an impure call, and a lazy initialiser runs
    // once rather than on every render either way.
    id: `scheme-${Date.now().toString(36)}`,
    name: 'My scheme',
    background: '#0b0b0f',
    surface: '#17171d',
    foreground: '#f4f4f5',
    muted: '#a1a1aa',
    accent: '#818cf8',
    base: 'dark',
  }));

  const problem = schemeProblem(draft);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Make your own</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="scheme-name" className="text-xs">
            Name
          </Label>
          <Input
            id="scheme-name"
            className="w-40"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </div>

        {(
          ['background', 'surface', 'foreground', 'muted', 'accent'] as const
        ).map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`scheme-${field}`} className="text-xs capitalize">
              {field}
            </Label>
            <Input
              id={`scheme-${field}`}
              type="color"
              className="h-9 w-16 p-1"
              value={draft[field]}
              onChange={(event) =>
                setDraft({ ...draft, [field]: event.target.value })
              }
            />
          </div>
        ))}
      </div>

      {problem && (
        <Alert variant="destructive">
          <AlertTitle>That would be hard to read</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={Boolean(problem)}
          onClick={() => saveCustomScheme(draft)}
        >
          Save and use
        </Button>
        {custom.map((entry) => (
          <Badge key={entry.id} variant="outline" className="gap-2">
            {entry.name}
            <button
              type="button"
              onClick={() => deleteCustomScheme(entry.id)}
              aria-label={`Delete ${entry.name}`}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════ people ═════════════════════════ */

/**
 * The backend, sync, and the devices on this account.
 *
 * The first thing this section does is say whether there is a backend at all,
 * because without one every control below it is inert — and a screen full of
 * switches that cannot work is exactly what this project refuses to ship.
 */
export function PeopleSettings() {
  const { settings, set } = useSettings();
  const status = backendStatus();
  const [sync, setSync] = useState<SyncStatus | null>(null);

  useEffect(() => {
    void syncStatus().then(setSync);
  }, []);

  if (!status.available) {
    return (
      <Group
        title="Backend"
        description="Profiles, following, shared playlists and sync."
      >
        <div className="px-4 py-4">
          <Alert>
            <AlertTitle>No backend is configured</AlertTitle>
            <AlertDescription>{status.reason}</AlertDescription>
          </Alert>
        </div>
      </Group>
    );
  }

  return (
    <>
      <Group
        title="Sync"
        description="Your library stays on this machine. What travels is a journal of changes, so signing out deletes a log rather than your music."
      >
        <Row
          label="Keep devices in step"
          hint="Likes, ratings, playlists and history. Everything works offline either way; sync is an addition, not a dependency."
          control={
            <Switch
              checked={settings.syncEnabled}
              onCheckedChange={(value) => set('syncEnabled', value)}
            />
          }
        />
        {sync && (
          <Row
            label="Queue"
            hint={
              sync.parked > 0
                ? 'Some changes could not be sent after repeated attempts. They are kept, not lost.'
                : 'Changes waiting to be sent.'
            }
            control={
              <span className="text-sm tabular-nums text-muted-foreground">
                {sync.pending} waiting
                {sync.parked > 0 ? `, ${sync.parked} stuck` : ''}
              </span>
            }
          />
        )}
        <Row
          label="Stop syncing and forget"
          hint="Deletes the journal here and on the backend. Your library, playlists and history are untouched."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void forgetLocalSync().then(
                  () => void syncStatus().then(setSync),
                );
              }}
            >
              Forget
            </Button>
          }
        />
      </Group>

      {/*
        The profile editor, rather than a local "share what I play" switch.

        That switch used to live here, writing `settings.shareActivity` — a
        preference nothing read. Publishing is gated by the *profile's*
        `shareActivity` flag, checked inside `social.record` on the server, so
        the local one could be on while nothing was published and off while
        everything was. It is gone, and the real control is one of the two in
        Visibility below.
      */}
    </>
  );
}

/* ═════════════════════════ profiles ═════════════════════════ */

export function ProfileSettings() {
  const [all, setAll] = useState<Profile[]>([]);
  const [active, setActive] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  // Subscribed to rather than copied: it is external mutable state, and both
  // of the obvious alternatives — reading it during render, or mirroring it in
  // an effect — are things React's compiler rejects for good reasons.
  const privateOn = useSyncExternalStore(
    subscribeToPrivate,
    isPrivate,
    () => false,
  );

  const reload = () => {
    void profiles().then(setAll);
    void activeProfile().then(setActive);
  };

  useEffect(reload, []);

  return (
    <>
      <Group
        title="Profiles"
        description="A partition of this installation, for a shared machine. There is no password and no security claim — anybody who can open the app can switch."
      >
        <Row
          label="Current profile"
          control={
            <Select
              value={active?.id ?? ''}
              onValueChange={(value) => {
                void switchProfile(value).then(reload);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {all.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Add a profile"
          control={
            <div className="flex gap-2">
              <Input
                className="w-40"
                value={name}
                placeholder="Name"
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                size="sm"
                disabled={!name.trim()}
                onClick={() => {
                  void createProfile(name, false).then(() => {
                    setName('');
                    reload();
                  });
                }}
              >
                Add
              </Button>
            </div>
          }
        />
        {all.length > 1 && active && (
          <Row
            label={`Remove “${active.name}”`}
            hint="The listening history and recommendations for this profile stay in the database; only the profile goes."
            control={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void deleteProfile(active.id).then(reload);
                }}
              >
                Remove
              </Button>
            }
          />
        )}
      </Group>

      <Group
        title="Content"
        description="What this profile is allowed to play."
      >
        <Row
          label="Hide explicit tracks"
          hint={EXPLICIT_FILTER_NOTE}
          control={
            <Switch
              checked={active?.noExplicit ?? false}
              onCheckedChange={(value) => {
                if (!active) return;
                void store
                  .profileUpsert({ ...active, noExplicit: value })
                  .then(reload);
              }}
            />
          }
        />
      </Group>

      <Group
        title="Listening"
        description="What the app records, and what it learns from it."
      >
        <Row
          label="Private session"
          hint="Nothing played is recorded or used for recommendations. Ends when the app closes, deliberately — a private session you forgot about is a gap in your history you cannot explain."
          control={<Switch checked={privateOn} onCheckedChange={setPrivate} />}
        />
        <Row
          label="Start fresh"
          hint="Clears history, blocked artists and the first-run answers — the three things recommendations are built from. Liked songs and playlists are kept: you made those."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void resetTaste()}
            >
              Reset recommendations
            </Button>
          }
        />
      </Group>
    </>
  );
}

/* ═════════════════════════ shortcuts ═════════════════════════ */

/**
 * Rebinding keys.
 *
 * In-app shortcuts and global ones are shown separately, because they are
 * genuinely different things: one is key handling inside a window, the other
 * takes a combination away from every other program on the machine — and a
 * global one that another program already holds fails, which is reported here
 * rather than swallowed.
 */
export function ShortcutSettings() {
  const [map, setMap] = useState<KeyMap>(DEFAULT_KEYS);
  const [recording, setRecording] = useState<Action | null>(null);
  const [globals, setGlobals] = useState<GlobalBinding[]>([]);
  const [rejected, setRejected] = useState<[string, string][]>([]);

  useEffect(() => {
    void loadKeyMap().then(setMap);
    void loadGlobalKeys().then(setGlobals);
  }, []);

  useEffect(() => {
    if (!recording) return;

    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      // Escape cancels rather than binding itself, which is what every key
      // recorder does and what somebody who opened this by accident will try.
      if (event.key === 'Escape') {
        setRecording(null);
        return;
      }
      // A bare modifier is half a shortcut; waiting for the other half is what
      // the user is doing.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

      const accel = accelerator(event);
      const clash = conflictFor(map, accel, recording);
      const next: KeyMap = { ...map, [recording]: accel };
      // A clash unbinds the other action rather than refusing: refusing means
      // the user has to find and clear the other one first, which they cannot
      // do without knowing which it is.
      if (clash) delete next[clash];

      setMap(next);
      void saveKeyMap(next);
      setRecording(null);
    };

    window.addEventListener('keydown', onKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true });
  }, [recording, map]);

  const actions = Object.keys(ACTION_LABELS) as Action[];

  return (
    <>
      <Group
        title="In the app"
        description="These work while a MadMusic window has focus. Click a shortcut to change it; Escape cancels."
      >
        {actions
          .filter((action) => action !== 'show-window')
          .map((action) => (
            <Row
              key={action}
              label={ACTION_LABELS[action]}
              control={
                <Button
                  variant={recording === action ? 'default' : 'outline'}
                  size="sm"
                  className="min-w-32 font-mono text-xs"
                  onClick={() => setRecording(action)}
                >
                  {recording === action
                    ? 'Press a key…'
                    : map[action]
                      ? describeKey(map[action] as string)
                      : 'Unassigned'}
                </Button>
              }
            />
          ))}
      </Group>

      <Group
        title="Anywhere on the machine"
        description="Global shortcuts work whatever window has focus, which means they take that combination away from every other program. Nothing is bound by default."
      >
        {(
          ['play-pause', 'next', 'previous', 'like', 'show-window'] as const
        ).map((action) => {
          const binding = globals.find((entry) => entry.action === action);
          const failure = rejected.find(
            ([accel]) => accel === binding?.accelerator,
          );

          return (
            <Row
              key={action}
              label={ACTION_LABELS[action]}
              hint={failure?.[1]}
              control={
                <div className="flex items-center gap-2">
                  <Input
                    className="w-40 font-mono text-xs"
                    placeholder="Ctrl+Alt+P"
                    value={binding?.accelerator ?? ''}
                    onChange={(event) => {
                      const accel = event.target.value;
                      setGlobals((existing) => {
                        const without = existing.filter(
                          (entry) => entry.action !== action,
                        );
                        return accel
                          ? [...without, { accelerator: accel, action }]
                          : without;
                      });
                    }}
                  />
                </div>
              }
            />
          );
        })}
        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <p className="text-xs text-muted-foreground">
            A combination another program already holds will be reported rather
            than silently ignored.
          </p>
          <Button
            size="sm"
            onClick={() => {
              void saveGlobalKeys(globals).then(() =>
                applyGlobalKeys(globals).then((result) =>
                  setRejected(result.rejected),
                ),
              );
            }}
          >
            Apply
          </Button>
        </div>
      </Group>

      <RemoteSection />
    </>
  );
}

/** The local control endpoint. */
function RemoteSection() {
  const { settings, set } = useSettings();
  const [status, setStatus] = useState<RemoteStatus>(REMOTE_OFF);

  useEffect(() => {
    void remoteStatus().then(setStatus);
  }, [settings.remoteControl]);

  if (!isNative()) return null;

  return (
    <Group
      title="Control from elsewhere"
      description="A loopback endpoint for a Stream Deck or a script. It listens on 127.0.0.1 only, needs a token, and can only do what the buttons in the app can do."
    >
      <Row
        label="Accept local commands"
        hint="Off by default. Without the token, any web page you visit could pause your music by fetching a localhost address — which is a real attack rather than a theoretical one."
        control={
          <Switch
            checked={settings.remoteControl}
            onCheckedChange={(value) => set('remoteControl', value)}
          />
        }
      />
      {status.running && (
        <>
          <Row
            label="Example"
            control={
              <code className="rounded bg-muted px-2 py-1 text-xs">
                {status.example}
              </code>
            }
          />
          <Row
            label="Token"
            hint="Issuing a new one invalidates whatever you pasted into a Stream Deck."
            control={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reissueRemoteToken().then(setStatus)}
              >
                Issue a new token
              </Button>
            }
          />
        </>
      )}
      {status.error && (
        <div className="px-4 py-3.5">
          <Alert variant="destructive">
            <AlertTitle>The endpoint could not start</AlertTitle>
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        </div>
      )}
    </Group>
  );
}

/* ═════════════════════════ updates and feedback ═════════════════════════ */

export function UpdateSettings() {
  const [channel, setChannel] = useState<Channel>('stable');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [telemetry, setTelemetry] = useState<TelemetryChoice>('unset');

  useEffect(() => {
    void loadChannel().then(setChannel);
    void loadTelemetry().then((stored) => setTelemetry(stored.choice));
  }, []);

  return (
    <>
      <Group
        title="Updates"
        description="Nothing is installed without being asked."
      >
        <Row
          label="Channel"
          hint="Beta gets changes earlier and breaks more often."
          control={
            <Select
              value={channel}
              onValueChange={(value) => {
                setChannel(value as Channel);
                void saveChannel(value as Channel);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="beta">Beta</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Check now"
          hint={
            update?.error
              ? update.error
              : update?.available
                ? `Version ${update.version} is available.`
                : update
                  ? 'You are up to date.'
                  : 'This build has no update endpoint configured yet, so it will find nothing.'
          }
          control={
            update?.available ? (
              <Button
                size="sm"
                onClick={() => {
                  void installUpdate((state) =>
                    setProgress(
                      state.total > 0 ? state.received / state.total : 0,
                    ),
                  ).then(() => void restartApp());
                }}
              >
                {progress > 0
                  ? `${Math.round(progress * 100)}%`
                  : 'Install and restart'}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!isNative()}
                onClick={() => void checkForUpdate().then(setUpdate)}
              >
                Check
              </Button>
            )
          }
        />
        {update?.available && update.notes && (
          <div className="px-4 py-3.5">
            <p className="text-xs whitespace-pre-wrap text-muted-foreground">
              {update.notes}
            </p>
          </div>
        )}
      </Group>

      <Group
        title="Reporting"
        description="There is no telemetry server. Reports are assembled here, shown to you in full, and copied for you to paste — nothing is sent automatically, because there is nowhere to send it."
      >
        <Row
          label="Keep error reports"
          hint="Recorded locally so the diagnostics screen has something to show. Sending remains something you do by hand."
          control={
            <Switch
              checked={telemetry === 'on'}
              onCheckedChange={(value) => {
                const choice: TelemetryChoice = value ? 'on' : 'off';
                setTelemetry(choice);
                void saveTelemetry({ choice, askedAt: Date.now() });
              }}
            />
          }
        />
        <Row
          label="Send feedback"
          hint="Opens a pre-filled issue in your browser. Attaching diagnostics is a checkbox there, not a default."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void feedbackUrl({
                  kind: 'idea',
                  body: '',
                  includeDiagnostics: false,
                }).then((url) => window.open(url, '_blank', 'noreferrer'));
              }}
            >
              Open a report
            </Button>
          }
        />
      </Group>
    </>
  );
}

/* ═════════════════════════ library tools ═════════════════════════ */

/**
 * Tidying up: duplicates, deleted playlists, and importing from elsewhere.
 *
 * In settings rather than in the library screen, because none of them are part
 * of listening. They are the things somebody does once, deliberately, and a
 * button for them in the browsing surface would be a permanent invitation to a
 * dialog nobody opens twice a year.
 */
export function LibraryToolsSettings() {
  const [duplicates, setDuplicates] = useState(false);
  const [health, setHealth] = useState(false);
  const [folders, setFolders] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [importing, setImporting] = useState(false);
  const [waveforms, setWaveforms] = useState({
    running: false,
    done: 0,
    total: 0,
  });
  const { settings, set } = useSettings();

  /**
   * Builds the waveforms that scrubbing and silence skipping need.
   *
   * One at a time and in the background: each one decodes a whole file, which
   * is a second of CPU per track. Doing a thousand at once would make the app
   * unusable for the twenty minutes it took.
   */
  const buildWaveforms = async () => {
    const tracks = await store.tracks({ kinds: ['local'], limit: 5000 });
    setWaveforms({ running: true, done: 0, total: tracks.length });

    for (const [index, track] of tracks.entries()) {
      if (!track.path) continue;
      const existing = await store.waveformGet(track.id).catch(() => null);
      if (existing) continue;

      await tryInvoke(
        'waveform_generate',
        { trackId: track.id, path: track.path },
        null,
      ).catch(() => null);

      setWaveforms({ running: true, done: index + 1, total: tracks.length });
    }

    setWaveforms((state) => ({ ...state, running: false }));
  };

  return (
    <>
      <Group title="Tidy up" description="Things worth doing once.">
        <Row
          label="Blocked from recommendations"
          hint="Artists you chose 'less like this' on. Still in your library and still playable - just not suggested."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBlocked(true)}
            >
              Review
            </Button>
          }
        />
        <Row
          label="Playlist folders"
          hint="A way to arrange a long list of playlists. Removing a folder leaves its playlists alone."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFolders(true)}
            >
              Arrange
            </Button>
          }
        />
        <Row
          label="Library health"
          hint="What is missing across the library - covers, years, track numbers - grouped by album, biggest gap first. Nothing changes a file until you ask it to."
          control={
            <Button variant="outline" size="sm" onClick={() => setHealth(true)}>
              Check
            </Button>
          }
        />
        <Row
          label="Find duplicates"
          hint="The same recording more than once, matched on title, artist and length rather than on a file hash — so a track ripped twice at different bitrates is found."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDuplicates(true)}
            >
              Look
            </Button>
          }
        />
        <Row
          label="Deleted playlists"
          hint="Every deletion keeps a snapshot. Nothing is really gone until you say so."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleted(true)}
            >
              Show
            </Button>
          }
        />
        <Row
          label="Import from another program"
          hint="M3U playlists, an iTunes library, or a Rekordbox collection — including the ratings and play counts, which are the part nobody can recreate."
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={!isNative()}
              onClick={() => setImporting(true)}
            >
              Import
            </Button>
          }
        />
      </Group>

      <Group
        title="Waveforms"
        description="A picture of each track, used for scrubbing, for silence skipping, and for pinning comments to a moment."
      >
        <Row
          label="Build them in the background"
          hint="Each one decodes a whole file, so this is off by default. There is no shortcut: the peaks are the audio."
          control={
            <Switch
              checked={settings.buildWaveforms}
              onCheckedChange={(value) => set('buildWaveforms', value)}
            />
          }
        />
        <Row
          label="Build them now"
          hint={
            waveforms.running
              ? `${waveforms.done} of ${waveforms.total}`
              : 'One at a time, so the app stays usable while it runs.'
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={waveforms.running || !isNative()}
              onClick={() => void buildWaveforms()}
            >
              {waveforms.running ? 'Working…' : 'Build'}
            </Button>
          }
        />
      </Group>

      <HealthReport open={health} onOpenChange={setHealth} />
      <PlaylistFolders open={folders} onOpenChange={setFolders} />
      <BlockedManager open={blocked} onOpenChange={setBlocked} />
      <DuplicatesDialog open={duplicates} onOpenChange={setDuplicates} />
      <PlaylistHistoryDialog
        playlistId=""
        open={deleted}
        onOpenChange={setDeleted}
        onRestored={() => {}}
      />
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        onImported={() => {}}
      />
    </>
  );
}

/**
 * What the native output actually achieved.
 *
 * The switch above says what was *asked for*. This says what happened, and on a
 * device that cannot do 192 kHz those are different things. A control reading
 * "bit-perfect" while the audio is quietly being resampled is worse than no
 * control at all, so the claim is only ever made from the engine's own report.
 */
function NativeOutputStatus() {
  const [state, setState] = useState<EngineState>(ENGINE_IDLE);

  useEffect(() => {
    // Polled rather than pushed: the engine has no event channel, and this
    // screen is open for seconds at a time. Two seconds is imperceptible here
    // and costs one small command.
    const read = () => {
      void engine
        .poll()
        .then(setState)
        .catch(() => setState(ENGINE_IDLE));
    };

    read();
    const timer = setInterval(read, 2_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="px-4 pb-4">
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {describeEngine(state)}
        {state.device && (
          <span className="mt-1 block font-mono">{state.device}</span>
        )}
      </p>
    </div>
  );
}

/* ═════════════════════════ sidebar arrangement ═════════════════════════ */

/**
 * Which destinations the sidebar shows, and in what order.
 *
 * # Why buttons rather than drag
 *
 * Because this list is short and drag reordering is the least accessible
 * interaction there is: it needs a pointer, precise aim, and a keyboard story
 * that almost nothing implements correctly. Up and down buttons work with a
 * keyboard, a screen reader and one finger, and the whole list fits on screen.
 *
 * # What cannot be hidden
 *
 * Home and Search. They are the only two rows that lead anywhere not already in
 * this list, so hiding both would produce a sidebar the user cannot navigate
 * out of and cannot undo from inside the app. Their switches are disabled and
 * `toggleHidden` refuses them as well — the guard is in the model, not only in
 * the control.
 *
 * Rows unavailable in this environment are shown greyed with the reason. The
 * alternative — omitting them — makes "why is Podcasts missing?" unanswerable
 * from the screen that is supposed to answer it.
 */
