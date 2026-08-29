import type * as React from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';

import { AppearanceProvider } from '@/components/common/appearance-provider';
import { AudioSettings } from '@/components/player/audio-settings';
import { AuthProvider } from '@/components/auth/auth-provider';
import { BackendProvider } from '@/components/common/backend-provider';
import { LibraryProvider } from '@/components/library/library-provider';
import { OsBridge } from '@/components/player/os-bridge';
import { Connect } from '@/components/player/connect';
import { RemoteProvider } from '@/components/player/remote-provider';
import { OfflineProvider } from '@/components/common/offline-provider';
import { PlayerProvider } from '@/components/player/player-provider';
import { BackupScheduler } from '@/components/common/backup-scheduler';
import { QueueDownloader } from '@/components/player/queue-downloader';
import { EpisodeProgress } from '@/components/player/episode-progress';
import { SavedProvider } from '@/components/common/saved-provider';
import { TrackActionsProvider } from '@/components/library/track-actions';
import { Scrobbler } from '@/components/player/scrobbler';
import { SettingsProvider } from '@/components/common/settings-provider';
import { SidebarLayoutProvider } from '@/components/common/sidebar-provider';
import { ThemeProvider } from '@/components/common/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Single composition root for every app-wide provider.
 *
 * Both `main.tsx` and the test render helper mount this, so a provider added
 * here is picked up by the app and the test suite at once — tests can never
 * drift into a different provider tree than the one that actually ships.
 *
 * Order matters: auth is outermost because sync depends on identity, the
 * backend sits just inside it because every Convex call carries an auth token,
 * settings sits above the theme because the theme reads preferences, and the
 * player sits above the library it consumes. Liked songs and history are
 * innermost of all, because they are written by *watching* the player rather
 * than by every play button remembering to report itself.
 *
 * Appearance sits *inside* the player, which reads the wrong way round until
 * you know why: the artwork tint follows the current track, so it needs the
 * player above it. Everything else it does — schemes, text scale, contrast —
 * would happily live anywhere.
 *
 * `reducedMotion="user"` is the whole accessibility story for Motion: it
 * disables transform and layout animations while *preserving* opacity and
 * colour, which is exactly right — content still cross-fades, nothing flies
 * around. Doing this per component would mean every future animation is one
 * forgotten check away from being inaccessible.
 *
 * `LazyMotion` is the other half. Motion's props-driven `motion.*` API cannot
 * be tree-shaken below ~34 kB, because every component must be able to handle
 * every prop. `m.*` plus a feature bundle loaded separately brings the initial
 * render to ~4.6 kB and then adds what is actually used.
 *
 * **`domMax`, not `domAnimation`**, and it is a measured choice rather than the
 * safe default. `domAnimation` (+15 kB) covers animations, variants, exit and
 * gestures; `domMax` (+25 kB) adds drag and **layout animations**. The album
 * artwork that flies from grid cell to detail header is a `layoutId`, and the
 * queue reorders with layout animation — both need `domMax`. Ten kilobytes for
 * the two most expensive-looking moments in the app is worth it; if either is
 * ever dropped, drop this to `domAnimation` in the same commit.
 *
 * The features are loaded through a dynamic `import()` rather than named here,
 * because naming them puts them straight back in the main chunk — measured,
 * and it made the bundle *larger* than not using `LazyMotion` at all.
 *
 * `strict` is on so this cannot rot. It makes any surviving `motion.*` throw
 * rather than silently pulling the full bundle back in and quietly undoing the
 * saving — a regression that is otherwise invisible until someone reads a
 * bundle report.
 */
/** Split out so Motion's feature bundle is fetched rather than bundled. */
const loadMotionFeatures = () =>
  import('@/lib/motion-features').then((module) => module.default);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <BackendProvider>
            <SettingsProvider>
              <ThemeProvider>
                <TooltipProvider>
                  <OfflineProvider>
                    <LibraryProvider>
                      <PlayerProvider>
                        <AppearanceProvider>
                          <SavedProvider>
                            <TrackActionsProvider>
                              <SidebarLayoutProvider>
                                {/* All three watch the player rather than being
                              called by it, for the same reason history does: a
                              play button that forgets to report itself is a
                              silent gap in someone's listening record, a lock
                              screen showing the wrong track, or an equaliser
                              that applies to some tracks and not others. */}
                                <RemoteProvider>
                                  <Scrobbler />
                                  <AudioSettings />
                                  <OsBridge />
                                  <Connect />
                                  <BackupScheduler />
                                  <QueueDownloader />
                                  <EpisodeProgress />
                                  {children}
                                </RemoteProvider>
                              </SidebarLayoutProvider>
                            </TrackActionsProvider>
                          </SavedProvider>
                        </AppearanceProvider>
                      </PlayerProvider>
                    </LibraryProvider>
                  </OfflineProvider>
                </TooltipProvider>
              </ThemeProvider>
            </SettingsProvider>
          </BackendProvider>
        </AuthProvider>
      </MotionConfig>
    </LazyMotion>
  );
}
