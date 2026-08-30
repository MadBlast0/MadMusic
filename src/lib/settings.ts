/**
 * Every user preference, in one shape.
 *
 * Two rules keep this honest as the app grows:
 *
 * 1. **A control that does nothing is worse than no control.** A setting that
 *    is designed but not built is declared here and marked `pending` where it
 *    is rendered, so the screen shows what is coming without pretending it
 *    works. A setting that can *never* work is removed instead; see the note
 *    about explicit content below. Crossfade, gapless and the cache limit were
 *    all in the first category and are now real — see `src/lib/audio-deck.ts`
 *    and `src-tauri/src/cache.rs`.
 * 2. **Defaults are the product.** Anything set here is what the overwhelming
 *    majority of users will ever experience, so each default is chosen rather
 *    than inherited from whatever was convenient.
 */

import type { BackupCadence } from '@/lib/auto-backup';
import type { DensityOverrides } from '@/lib/density';
import type { PagingMode } from '@/lib/paging';
import type { VolumeCurve } from '@/lib/audio/curve';

export type Density = 'comfortable' | 'compact';
export type Quality = 'low' | 'balanced' | 'high';
export type StartupView = 'home' | 'library' | 'last';
/** How loud a normalised library should sit. See `audio/replaygain.ts`. */
export type LoudnessProfile = 'quiet' | 'normal' | 'loud';
/** How large album artwork is in a grid. */
export type GridSize = 'small' | 'medium' | 'large';

export type Settings = {
  /* ── appearance ─────────────────────────────────────────────── */
  density: Density;
  /**
   * Screens that ignore the setting above.
   *
   * Absent by default, and an entry is removed rather than set back to the
   * global value when somebody chooses "follow" — see `src/lib/density.ts` for
   * why that distinction matters.
   */
  densityOverrides: DensityOverrides;
  /** Force stillness even where the OS does not ask for it. */
  reduceMotion: boolean;
  /** The dancing bars beside the current track. */
  showEqualiser: boolean;
  showPlaylistArt: boolean;
  /**
   * How a long list of results is revealed: all at once as you scroll, or a
   * page at a time. See `src/lib/paging.ts` for why this is a choice.
   */
  paging: PagingMode;

  /* ── playback ───────────────────────────────────────────────── */
  /** Seconds skipped by the arrow keys. */
  seekStep: number;
  /** Seconds of overlap between tracks. 0 is off. */
  crossfade: number;
  gapless: boolean;
  normaliseVolume: boolean;
  /** Keep playing past the end of the queue with similar tracks. */
  autoplaySimilar: boolean;
  /** Restore the last track, paused, at launch. */
  resumeOnLaunch: boolean;
  quality: Quality;

  /**
   * Seconds after which "previous" restarts the track instead of going back.
   *
   * Three is the number every player converged on. Configurable because the
   * right value depends on how fast somebody skips, and because it costs
   * nothing to let them choose.
   */
  restartThreshold: number;
  /** Jump past silence at the start and end of a track. */
  skipSilence: boolean;
  /** How loud normalisation aims. Only applies when `normaliseVolume` is on. */
  loudnessProfile: LoudnessProfile;
  /** Use the album's gain rather than each track's, keeping a record's dynamics. */
  albumGain: boolean;
  /** Lift the extremes at low volume, compensating for how hearing works. */
  loudnessCompensation: boolean;
  /** Fold both channels together. An accessibility control, not an effect. */
  monoAudio: boolean;
  /** -1 fully left, 0 centred, +1 fully right. */
  balance: number;
  /** Seconds of fade on play and pause. Zero is off. */
  playPauseFade: number;
  /** The output device id, or `default`. */
  outputDevice: string;
  /**
   * How the volume slider maps onto amplitude.
   *
   * Logarithmic matches how loudness is perceived and is the right default;
   * linear is what most other players do, and is here for anybody matching
   * levels against one of them by ear.
   */
  volumeCurve: VolumeCurve;
  /** Fade only between tracks that suit it, rather than across every join. */
  smartCrossfade: boolean;
  /** Nudge the incoming track's rate into step with the outgoing one. */
  beatMatch: boolean;
  /** Show a live loudness meter in the now-playing bar. */
  showLoudnessMeter: boolean;
  /** Keep playing when the machine sleeps or the lid closes, if it can. */
  keepPlayingAsleep: boolean;
  /** Pass multi-channel audio through untouched rather than folding it down. */
  spatialPassthrough: boolean;
  /**
   * Decode and play local files in Rust at the file's own sample rate.
   *
   * Bypasses the webview's resampler. Inaudible to almost everybody, and the
   * entire point for the few who asked. See `src-tauri/src/engine.rs`.
   */
  nativeOutput: boolean;

  /* ── catalogue ──────────────────────────────────────────────── */
  // The explicit-content filter is not here, and that is not an oversight
  // either way: it is a property of a *profile* rather than of the app — a
  // household sharing one install needs it on for one person and off for
  // another — so it lives on `Profile` in `src/lib/profiles.ts`.
  //
  // Half of the original note still holds. YouTube Music's API reports no
  // explicit flag, so the filter cannot cover the catalogue. It does cover
  // local files, fetched metadata and uploads, and the settings screen says
  // exactly that rather than implying it covers everything.
  // There is no "prefer audio-only" setting, and that is deliberate rather
  // than an omission. The extractor only ever reads `player.audio_streams` --
  // it never requests a video stream for anything -- so a toggle would have
  // had nothing to switch between. A control that can never change the
  // behaviour is worse than no control, so it was removed rather than left
  // sitting there looking meaningful.
  /**
   * Keep the next few tracks of the queue downloaded.
   *
   * Different from `prefetchNext`, which resolves one stream URL ahead:
   * downloaded audio does not expire and survives losing the connection.
   */
  downloadAhead: boolean;
  /** Fetch the next track's stream before it is needed. */
  prefetchNext: boolean;
  /** Megabytes of audio kept on disk. */
  cacheLimitMb: number;
  /** Drop to a lower quality when the connection cannot keep up. */
  adaptiveQuality: boolean;
  /** Fetch nothing but audio, and only when asked. */
  dataSaver: boolean;
  /** The quality downloads are fetched at, which may exceed streaming. */
  downloadQuality: Quality;
  /** Only download on a connection nobody is paying for by the megabyte. */
  downloadOnWifiOnly: boolean;
  /** Fetch lyrics, biographies, credits and artwork from the metadata services. */
  fetchMetadata: boolean;
  /**
   * A generated moving backdrop behind the full-screen player.
   *
   * Not Spotify's Canvas - there is no source for artist-uploaded loops
   * outside Spotify. This is two soft shapes in the track's own colours,
   * drifting and breathing with the music.
   */
  trackVisuals: boolean;
  /** Show time-synced lyrics where they exist. */
  showLyrics: boolean;

  /* ── library ────────────────────────────────────────────────── */
  /** Re-read the folder when files change underneath us. */
  watchFolder: boolean;
  /** How often to write a backup without being asked. */
  autoBackup: BackupCadence;
  /** Where those go. Empty means nowhere has been chosen yet. */
  autoBackupFolder: string;
  /**
   * Hide anything that cannot be played right now.
   *
   * Not the same as being offline: somebody on a metered connection may want
   * this on while perfectly able to reach the network.
   */
  offlineOnly: boolean;
  restoreLibraryOnLaunch: boolean;
  /**
   * Bring back the queue from last time on launch.
   *
   * Restores it *paused*. Resuming audio by itself on startup is startling,
   * and on a shared machine it is worse than that.
   */
  restoreQueueOnLaunch: boolean;
  /** Generate waveforms in the background, for scrubbing and silence skipping. */
  buildWaveforms: boolean;
  gridSize: GridSize;

  /* ── general ────────────────────────────────────────────────── */
  startupView: StartupView;
  /** Hardware play/pause keys and headset buttons. */
  mediaKeys: boolean;
  minimiseToTray: boolean;
  confirmOnQuitWhilePlaying: boolean;
  /** Start MadMusic when you sign in. */
  launchAtLogin: boolean;
  /** Start hidden, for a login item that should not steal focus. */
  startMinimised: boolean;
  /** Post a notification on a track change when the window is not focused. */
  notifyOnTrackChange: boolean;
  /** Show what you are listening to on your Discord profile. */
  discordPresence: boolean;
  /** Accept commands on the local control endpoint. Off by default. */
  remoteControl: boolean;

  /* ── privacy ────────────────────────────────────────────────── */
  keepHistory: boolean;
  scrobble: boolean;
  /*
    There is deliberately no `shareActivity` here.

    There was, and it did nothing: publishing was gated on the server, and a
    local mirror of a server-side permission is a control that can disagree
    with reality in both directions. The whole social half has since been
    removed, so there is nothing left to publish and nothing left to gate.
  */
  /** Keep the library in step across devices. */
  syncEnabled: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  density: 'comfortable',
  densityOverrides: {},
  reduceMotion: false,
  showEqualiser: true,
  showPlaylistArt: true,
  paging: 'infinite',

  seekStep: 5,
  crossfade: 0,
  gapless: true,
  normaliseVolume: false,
  autoplaySimilar: true,
  resumeOnLaunch: true,
  quality: 'balanced',

  restartThreshold: 3,
  skipSilence: false,
  loudnessProfile: 'normal',
  albumGain: false,
  loudnessCompensation: false,
  monoAudio: false,
  balance: 0,
  playPauseFade: 0.12,
  volumeCurve: 'logarithmic',
  smartCrossfade: true,
  beatMatch: false,
  showLoudnessMeter: false,
  keepPlayingAsleep: true,
  spatialPassthrough: false,
  outputDevice: 'default',
  nativeOutput: false,

  downloadAhead: false,
  prefetchNext: true,
  cacheLimitMb: 2048,
  adaptiveQuality: true,
  dataSaver: false,
  downloadQuality: 'high',
  downloadOnWifiOnly: true,
  fetchMetadata: true,
  trackVisuals: true,
  showLyrics: true,

  watchFolder: false,
  autoBackup: 'off',
  autoBackupFolder: '',
  offlineOnly: false,
  restoreLibraryOnLaunch: true,
  restoreQueueOnLaunch: true,
  buildWaveforms: false,
  gridSize: 'medium',

  startupView: 'home',
  mediaKeys: true,
  minimiseToTray: false,
  confirmOnQuitWhilePlaying: false,
  launchAtLogin: false,
  startMinimised: false,
  notifyOnTrackChange: false,
  discordPresence: false,
  remoteControl: false,

  keepHistory: true,
  scrobble: false,
  syncEnabled: false,
};

export const SETTINGS_KEY = 'madmusic-settings';

/**
 * Merges stored values over the defaults, field by field.
 *
 * A blanket spread would let a settings file written by an older build resurrect
 * a key that has since been removed, or leave a newly added key undefined. Only
 * keys the current shape declares survive a read.
 */
export function mergeSettings(stored: unknown): Settings {
  if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;
  const source = stored as Record<string, unknown>;
  const merged = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = source[key];
    // `typeof null` is `'object'`, so a null written by an older build would
    // otherwise be accepted in place of an object-valued setting and every
    // reader would have to defend against it.
    if (value !== null && typeof value === typeof DEFAULT_SETTINGS[key]) {
      // Index-signature-free assignment across a heterogeneous record needs a
      // cast; the runtime typeof check above is the actual guarantee.
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

/**
 * The current settings, read outside React.
 *
 * The provider is the right way to read settings in a component, and this is
 * not a replacement for it. It exists for the library modules — lyrics,
 * metadata, artwork — which are plain async functions called from anywhere and
 * cannot hold a hook, but which still have to honour "fetch nothing but audio".
 *
 * Reads straight from storage rather than caching, because a setting changed in
 * one window must take effect in the next fetch, not the next reload. The read
 * is a few hundred bytes of JSON and happens once per network call, which is
 * nothing next to the request it is deciding about.
 */
export function currentSettings(): Settings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? mergeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    // Unreadable or corrupt. The defaults are a working app.
    return DEFAULT_SETTINGS;
  }
}
